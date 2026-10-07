import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { checkRateLimit, consumeCounter } from "../rateLimiter";
import type { Database } from "@/db/db";

const dialect = new PgDialect();

interface CapturedStatement {
  values: Record<string, any>;
  setCountSql: string;
  setCountParams: unknown[];
  setOther: Record<string, unknown>;
  setWhereSql: string;
  setWhereParams: unknown[];
}

/**
 * Stubs the database at the upsert boundary. `onConflictDoUpdate` is evaluated against a real
 * in-memory row using the same rules as Postgres applies, with `maxRequests` read back out of the
 * rendered `setWhere` params rather than duplicated here, so changing the cap in the SQL cannot
 * leave this stub asserting a stale number.
 *
 * The one behaviour this models that a naive mock would miss: `DO UPDATE ... WHERE false` performs
 * no update and returns no row, which is how a rejected request is reported without writing.
 */
function createStubDb(initialRecords: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initialRecords));
  const statements: CapturedStatement[] = [];
  let selectCalls = 0;

  const client = {
    select: () => {
      selectCalls++;
      throw new Error("consumeCounter must not read before writing; a read-then-write races on a missing row");
    },
    insert: () => ({
      values: (values: Record<string, any>) => ({
        onConflictDoUpdate: ({ set, setWhere }: any) => ({
          returning: async () => {
            const countRendered = dialect.sqlToQuery(set.count);
            const whereRendered = dialect.sqlToQuery(setWhere);
            statements.push({
              values,
              setCountSql: countRendered.sql,
              setCountParams: countRendered.params,
              setOther: set,
              setWhereSql: whereRendered.sql,
              setWhereParams: whereRendered.params,
            });

            // The cap travels as the last bind param of the guard expression.
            const cap = Number(whereRendered.params[whereRendered.params.length - 1]);
            const key = `${values.userId}:${values.action}`;
            const existing = store.get(key);

            if (!existing) {
              // INSERT path: the row is created with count 1 inside the current window.
              store.set(key, { ...values });
              return [{ count: 1, windowEnd: values.windowEnd }];
            }

            const expired = existing.windowEnd.getTime() <= values.updatedAt.getTime();
            // The guard fails => the row is left untouched and no row comes back.
            if (!expired && existing.count >= cap) return [];

            store.set(key, {
              ...existing,
              count: expired ? 1 : existing.count + 1,
              windowStart: expired ? values.windowStart : existing.windowStart,
              windowEnd: expired ? values.windowEnd : existing.windowEnd,
              updatedAt: values.updatedAt,
            });

            const row = store.get(key);
            return [{ count: row.count, windowEnd: row.windowEnd }];
          },
        }),
      }),
    }),
  };

  // `consumeCounter` accepts either a database or an open transaction client, so the stub exposes
  // the same client at both levels and a test can use whichever one it is exercising.
  const db = {
    ...client,
    transaction: async (cb: (tx: any) => Promise<any>) => await cb(client),
  } as unknown as Database;

  return { db, client, store, statements, selectCalls: () => selectCalls };
}

describe("consumeCounter", () => {
  it("writes one upsert statement and never reads first", async () => {
    const { db, statements, selectCalls } = createStubDb();

    await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowStart: new Date(),
      windowEnd: new Date(Date.now() + 60000),
    });

    // The old shape was SELECT ... FOR UPDATE then INSERT. On a user's first request FOR UPDATE
    // locks nothing, so concurrent callers each reset count to 1. One upsert has no such gap.
    expect(selectCalls()).toBe(0);
    expect(statements).toHaveLength(1);
  });

  it("creates the counter on the first request", async () => {
    const { db, store } = createStubDb();

    const result = await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowStart: new Date(),
      windowEnd: new Date(Date.now() + 60000),
    });

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(store.get("user-1:chat").count).toBe(1);
  });

  it("increments within an open window and stops at maxRequests", async () => {
    const now = new Date();
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 2,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 60000),
        updatedAt: now,
      },
    });

    const result = await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
      now,
    });

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(3);
    expect(store.get("user-1:chat").count).toBe(3);
  });

  it("grants the last available slot instead of consuming it and rejecting", async () => {
    const now = new Date();
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        // One below the cap: this request is the last slot.
        count: 24,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 60000),
        updatedAt: now,
      },
    });

    const result = await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 25,
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
      now,
    });

    // RETURNING reads the updated row, so the previous `count < max` test evaluated 25 < 25 and
    // reported this request as rejected while still consuming the slot.
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(25);
    expect(store.get("user-1:chat").count).toBe(25);
  });

  it("rejects without writing once the counter is full", async () => {
    const now = new Date();
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 25,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 60000),
        updatedAt: now,
      },
    });

    const result = await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 25,
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
      now,
    });

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(25);
    // The stored counter counts consumed units only. A rejection leaves it alone, so a later
    // rollback of a real consumption refunds exactly that slot instead of being swallowed here.
    expect(store.get("user-1:chat").count).toBe(25);
  });

  it("keeps rejected attempts out of the stored counter under repeated hammering", async () => {
    const now = new Date();
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 25,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 60000),
        updatedAt: now,
      },
    });

    for (let i = 0; i < 5; i++) {
      const result = await consumeCounter(db, {
        userId: "user-1",
        action: "chat",
        maxRequests: 25,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 60000),
        now,
      });
      expect(result.allowed).toBe(false);
    }

    // getPlanUsage reads this column directly, so an attempt count here would be reported as usage.
    expect(store.get("user-1:chat").count).toBe(25);
  });

  it("starts a fresh window when the stored window has expired", async () => {
    const past = new Date(Date.now() - 5000);
    const now = new Date();
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 10,
        windowStart: new Date(Date.now() - 65000),
        windowEnd: past,
        updatedAt: past,
      },
    });

    const result = await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
      now,
    });

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(store.get("user-1:chat").count).toBe(1);
    expect(store.get("user-1:chat").windowEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  it("guards the update instead of clamping the stored count", async () => {
    const { db, statements } = createStubDb();

    await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 7,
      windowStart: new Date(),
      windowEnd: new Date(Date.now() + 60000),
    });

    expect(statements[0].setCountSql).toContain('"rate_limits"."window_end" <=');
    expect(statements[0].setCountSql).toContain('"rate_limits"."count" + 1');
    // The cap travels as a bind param in the DO UPDATE guard, so one statement serves every limit.
    expect(statements[0].setWhereParams).toContain(7);
    expect(statements[0].setWhereSql).toContain('"rate_limits"."count" <');
  });
});

describe("checkRateLimit", () => {
  it("allows the first request and sets window", async () => {
    const { db, store } = createStubDb();

    const result = await checkRateLimit(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowMs: 60000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBeGreaterThan(Date.now());
    expect(store.get("user-1:chat").count).toBe(1);
  });

  it("rejects when count reaches maxRequests", async () => {
    const now = new Date();
    const futureWindow = new Date(now.getTime() + 50000);
    const { db } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 5,
        windowStart: now,
        windowEnd: futureWindow,
        updatedAt: now,
      },
    });

    const result = await checkRateLimit(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowMs: 60000,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    // A rejected request writes nothing, so its `windowEnd` is the caller's requested one, which is
    // an upper bound on the stored window's end. `Retry-After` is therefore never too short.
    expect(result.resetAt).toBeGreaterThanOrEqual(futureWindow.getTime());
    expect(result.resetAt).toBeLessThanOrEqual(futureWindow.getTime() + 60000);
  });

  it("resets the window when the existing window has expired", async () => {
    const pastWindow = new Date(Date.now() - 5000);
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 10,
        windowStart: new Date(Date.now() - 65000),
        windowEnd: pastWindow,
        updatedAt: pastWindow,
      },
    });

    const result = await checkRateLimit(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowMs: 60000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(store.get("user-1:chat").count).toBe(1);
    expect(store.get("user-1:chat").windowEnd.getTime()).toBeGreaterThan(Date.now());
  });
});
