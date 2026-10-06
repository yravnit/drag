import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../rateLimiter";
import type { Database } from "@/db/db";

function createMockRateLimitDb(initialRecords: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(initialRecords));

  const db = {
    transaction: async (cb: (tx: any) => Promise<any>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: (_mode: string) => {
                // Return copy of stored record or empty
                const rec = store.get("test-key");
                return Promise.resolve(rec ? [rec] : []);
              },
            }),
          }),
        }),
        insert: () => ({
          values: (vals: any) => ({
            onConflictDoUpdate: ({ set }: any) => {
              store.set("test-key", { ...vals, ...set });
              return Promise.resolve();
            },
          }),
        }),
        update: () => ({
          set: (vals: any) => ({
            where: () => {
              const current = store.get("test-key") || {};
              store.set("test-key", { ...current, ...vals });
              return Promise.resolve();
            },
          }),
        }),
      };
      return await cb(tx);
    },
  } as unknown as Database;

  return { db, store };
}

describe("checkRateLimit", () => {
  it("allows the first request and sets window", async () => {
    const { db, store } = createMockRateLimitDb();

    const result = await checkRateLimit(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowMs: 60000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBeGreaterThan(Date.now());
    expect(store.get("test-key").count).toBe(1);
  });

  it("increments the count on subsequent allowed requests", async () => {
    const futureWindow = new Date(Date.now() + 50000);
    const { db, store } = createMockRateLimitDb({
      "test-key": {
        userId: "user-1",
        action: "chat",
        count: 2,
        windowStart: new Date(),
        windowEnd: futureWindow,
      },
    });

    const result = await checkRateLimit(db, {
      userId: "user-1",
      action: "chat",
      maxRequests: 5,
      windowMs: 60000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(store.get("test-key").count).toBe(3);
  });

  it("rejects when count reaches maxRequests", async () => {
    const futureWindow = new Date(Date.now() + 50000);
    const { db } = createMockRateLimitDb({
      "test-key": {
        userId: "user-1",
        action: "chat",
        count: 5,
        windowStart: new Date(),
        windowEnd: futureWindow,
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
    const { db, store } = createMockRateLimitDb({
      "test-key": {
        userId: "user-1",
        action: "chat",
        count: 10,
        windowStart: new Date(Date.now() - 65000),
        windowEnd: pastWindow,
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
    expect(store.get("test-key").count).toBe(1);
    expect(store.get("test-key").windowEnd.getTime()).toBeGreaterThan(Date.now());
  });
});
