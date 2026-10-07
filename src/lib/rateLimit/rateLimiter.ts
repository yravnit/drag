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
  /** Usage within the window, clamped to `maxRequests`. */
  count: number;
  windowEnd: Date;
}

/**
 * Atomically consumes one unit from a (userId, action) counter, creating the row if needed.
 *
 * This is a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`, which is what makes it
 * safe on a user's very first request. The previous shape was `SELECT ... FOR UPDATE`, then a
 * separate insert: `FOR UPDATE` locks nothing when the row does not exist yet, so every concurrent
 * first request saw no row and each conflicting insert reset `count` to 1. Requests were silently
 * undercounted and callers got work beyond their limits.
 *
 * One statement closes both holes. The insert takes the row lock for a brand new counter, and a
 * conflicting request blocks until the winner commits and then increments the committed row.
 *
 * `allowed` is the post-update `count <= maxRequests` because RETURNING evaluates against the
 * updated row. Clamping the stored counter instead made the last available slot look consumed *and*
 * rejected, so a Free user got 24 of their 25 monthly queries.
 */
export async function consumeCounter(
  client: DbOrTx,
  options: ConsumeCounterOptions,
): Promise<ConsumeCounterResult> {
  const { userId, action, maxRequests, windowStart, windowEnd } = options;
  const now = options.now ?? new Date();

  // `window_end <= now` means the previous window is over, so this request starts a fresh one.
  // Unqualified column references inside ON CONFLICT DO UPDATE read the pre-update row, which is
  // what makes this expression safe to compute in the same statement as the write.
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
      set: {
        // The counter always advances. RETURNING reads the *updated* row, so a counter that
        // clamped at maxRequests could not tell "this request took the last slot" from "the
        // counter was already full": both end at maxRequests. Advancing unconditionally makes the
        // stored value an attempt count and lets the returned flag below answer exactly that
        // question. Rejections overshoot rather than being granted a slot.
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${windowStart} ELSE ${rateLimits.windowStart} END`,
        windowEnd: sql`CASE WHEN ${expired} THEN ${windowEnd} ELSE ${rateLimits.windowEnd} END`,
        updatedAt: now,
      },
    })
    .returning({
      count: rateLimits.count,
      windowEnd: rateLimits.windowEnd,
      // Post-update count <= maxRequests is exactly "the count was below the limit before this
      // statement", i.e. this request consumed a slot.
      allowed: sql<boolean>`${rateLimits.count} <= ${maxRequests}`,
    })) as Array<{ count: number; windowEnd: Date; allowed: boolean }>;

  const row = rows[0];
  return {
    allowed: row.allowed,
    // Clamped so callers keep reading usage as "consumed", not "attempted".
    count: Math.min(row.count, maxRequests),
    windowEnd: row.windowEnd,
  };
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
