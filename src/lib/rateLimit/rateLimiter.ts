import { Database } from "@/db/db";
import { rateLimits } from "@/db/schema";
import { sql } from "drizzle-orm";

export interface RateLimitOptions {
  userId: string;
  action: string;
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Accepts a database or an open transaction client. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ConsumeCounterOptions {
  userId: string;
  action: string;
  maxRequests: number;
  /** Start of the counting window. */
  windowStart: Date;
  /** End of the counting window. */
  windowEnd: Date;
  now?: Date;
}

export interface ConsumeCounterResult {
  allowed: boolean;
  /** Consumed units in the window. A rejected request never changes this. */
  count: number;
  windowEnd: Date;
}

/**
 * Atomically consumes one unit from a (userId, action) counter, creating the row if needed.
 *
 * This is a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which is what makes it safe on
 * a user's very first request. The previous shape was `SELECT ... FOR UPDATE`, then a separate
 * insert: `FOR UPDATE` locks nothing when the row does not exist yet, so every concurrent first
 * request saw no row and each conflicting insert reset `count` to 1. Requests were silently
 * undercounted and callers got work beyond their limits.
 *
 * One statement closes both holes. The insert takes the row lock for a brand new counter, and a
 * conflicting request blocks until the winner commits and then increments the committed row.
 *
 * Two facts about Postgres drive the shape below, and both were bugs:
 *
 * 1. `RETURNING` evaluates against the *updated* row. Clamping the stored counter at
 *    `maxRequests` and then testing `count < maxRequests` made the last available slot look
 *    consumed *and* rejected, so a Free user got 24 of their 25 monthly queries.
 * 2. `ON CONFLICT DO UPDATE ... WHERE <false>` performs no update and, crucially, returns no row.
 *
 * So the update is guarded (`setWhere`) rather than clamped: a request that finds the counter full
 * writes nothing and yields no row, which is exactly `allowed: false`. The stored count therefore
 * only ever counts consumed units — it never inflates on rejection, so `getPlanUsage` cannot read an
 * inflated number and `rollbackMonthlyQueryQuota`'s decrement always refunds a real consumption.
 */
export async function consumeCounter(
  client: DbOrTx,
  options: ConsumeCounterOptions,
): Promise<ConsumeCounterResult> {
  const { userId, action, maxRequests, windowStart, windowEnd } = options;
  const now = options.now ?? new Date();

  // `window_end <= now` means the previous window is over, so this request starts a fresh one.
  // Unqualified column references inside ON CONFLICT DO UPDATE read the pre-update row, which is
  // what makes these expressions safe to compute in the same statement as the write.
  const expired = sql`${rateLimits.windowEnd} <= ${now}`;

  const rows = (await client
    .insert(rateLimits)
    .values({
      userId,
      action,
      count: 1,
      windowStart,
      windowEnd,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [rateLimits.userId, rateLimits.action],
      // The guard runs against the stored row, before the increment. False means "counter already
      // full, window still open": nothing is written and the statement returns no row.
      setWhere: sql`${expired} OR ${rateLimits.count} < ${maxRequests}`,
      set: {
        // Reached only when the guard above passed, so this always describes a real consumption.
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${windowStart} ELSE ${rateLimits.windowStart} END`,
        windowEnd: sql`CASE WHEN ${expired} THEN ${windowEnd} ELSE ${rateLimits.windowEnd} END`,
        updatedAt: now,
      },
    })
    .returning({
      count: rateLimits.count,
      windowEnd: rateLimits.windowEnd,
    })) as Array<{ count: number; windowEnd: Date }>;

  const row = rows[0];
  if (!row) {
    // Rejected: the stored counter is at `maxRequests` and unchanged. Report the clamped count so
    // callers keep the "used / limit" shape without learning how many attempts were rejected.
    return { allowed: false, count: maxRequests, windowEnd };
  }

  return { allowed: true, count: row.count, windowEnd: row.windowEnd };
}

/**
 * Atomic Postgres-backed rate limiter for rolling windows.
 *
 * Backed by {@link consumeCounter}, so the first request of a window is safe under concurrency.
 */
export async function checkRateLimit(
  database: Database,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { userId, action, maxRequests, windowMs } = options;
  const now = new Date();

  return await database.transaction(async (tx) => {
    const result = await consumeCounter(tx, {
      userId,
      action,
      maxRequests,
      windowStart: now,
      windowEnd: new Date(now.getTime() + windowMs),
      now,
    });

    return {
      allowed: result.allowed,
      remaining: Math.max(0, maxRequests - result.count),
      resetAt: result.windowEnd.getTime(),
    };
  });
}
