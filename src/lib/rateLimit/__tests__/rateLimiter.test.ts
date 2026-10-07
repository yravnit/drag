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
}

/**
 * Stubs the database at the upsert boundary. `onConflictDoUpdate` is evaluated against a real
 * in-memory row using the CASE the caller supplied, with `maxRequests` read back out of the
 * rendered SQL params rather than duplicated here, so changing the cap in the SQL cannot leave
 * this stub asserting a stale number.
 */
function createStubDb(initialRecords: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initialRecords));
  const statements: CapturedStatement[] = [];
  let selectCalls = 0;

  /**
   * Both rendered expressions carry the cap as their last bind param, so the stub reads it from the
   * SQL instead of hard-coding a number that could drift from the implementation.
   */
  const capFrom = (params: unknown[]) => Number(params[params.length - 1]);

  const client = {
    select: () => {
      selectCalls++;
      throw new Error("consumeCounter must not read before writing; a read-then-write races on a missing row");
    },
    insert: () => ({
      values: (values: Record<string, any>) => ({
        onConflictDoUpdate: ({ set }: any) => ({
          returning: async () => {
            const countRendered = dialect.sqlToQuery(set.count);
            const statementsPush: CapturedStatement = {
              values,
              setCountSql: countRendered.sql,
              setCountParams: countRendered.params,
              setOther: set,
            };
            statements.push(statementsPush);

            const cap = capFrom(countRendered.params);
            const key = `${values.userId}:${values.action}`;
            const existing = store.get(key);

            if (!existing) {
              // INSERT path: the row is created with count 1 inside the current window.
              store.set(key, { ...values });
              return [{ count: 1, windowEnd: values.windowEnd, allowed: cap >= 1 }];
            }

            const expired = existing.windowEnd.getTime() <= values.updatedAt.getTime();
            const nextCount = expired ? 1 : existing.count < cap ? existing.count + 1 : existing.count;
            const allowed = expired || existing.count < cap;

            store.set(key, {
              ...existing,
              count: nextCount,
              windowStart: expired ? values.windowStart : existing.windowStart,
              windowEnd: expired ? values.windowEnd : existing.windowEnd,
              updatedAt: values.updatedAt,
            });

            const row = store.get(key);
            return [
              {
                count: row.count,
                windowEnd: row.windowEnd,
                allowed,
              },
            ];
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

  it("rejects and stops inflating once maxRequests is reached", async () => {
    const now = new Date();
    const { db, store } = createStubDb({
      "user-1:chat": {
        userId: "user-1",
        action: "chat",
        count: 3,
        windowStart: now,
        windowEnd: new Date(now.getTime() + 60000),
        updatedAt: now,
      },
    });

    const result = await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 3,
      windowStart: now,
      windowEnd: new Date(now.getTime() + 60000),
      now,
    });

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(3);
    // Rejected requests must not inflate usage: 3/3 stays 3/3, not 4/3.
    expect(store.get("user-1:chat").count).toBe(3);
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

  it("encodes the limit and window reset in one CASE expression", async () => {
    const { db, statements } = createStubDb();

    await consumeCounter(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 7,
      windowStart: new Date(),
      windowEnd: new Date(Date.now() + 60000),
    });

    const sqlText = statements[0].setCountSql;
    expect(sqlText).toContain('"rate_limits"."window_end" <=');
    expect(sqlText).toContain('"rate_limits"."count" + 1');
    // The cap travels as a bind param, so the same statement is reused for every limit.
    expect(statements[0].setCountParams).toContain(7);
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
    expect(result.resetAt).toBe(futureWindow.getTime());
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
