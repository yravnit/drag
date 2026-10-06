import { Database } from "@/db/db";
import { rateLimits } from "@/db/schema";
import { and, eq } from "drizzle-orm";

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

/**
 * Atomic Postgres-backed rate limiter.
 *
 * Uses SELECT ... FOR UPDATE inside a database transaction to serialize
 * updates per (userId, action), preventing race conditions under concurrency.
 */
export async function checkRateLimit(
  database: Database,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { userId, action, maxRequests, windowMs } = options;
  const now = new Date();

  return await database.transaction(async (tx) => {
    // 1. Lock existing row if present to serialize concurrent requests
    const [existing] = await tx
      .select()
      .from(rateLimits)
      .where(and(eq(rateLimits.userId, userId), eq(rateLimits.action, action)))
      .for("update");

    if (!existing || now > existing.windowEnd) {
      // Window expired or no prior record: initialize new window with count 1
      const windowEnd = new Date(now.getTime() + windowMs);

      await tx
        .insert(rateLimits)
        .values({
          userId,
          action,
          count: 1,
          windowStart: now,
          windowEnd,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [rateLimits.userId, rateLimits.action],
          set: {
            count: 1,
            windowStart: now,
            windowEnd,
            updatedAt: now,
          },
        });

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - 1),
        resetAt: windowEnd.getTime(),
      };
    }

    if (existing.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.windowEnd.getTime(),
      };
    }

    // Atomically increment counter
    const newCount = existing.count + 1;
    await tx
      .update(rateLimits)
      .set({
        count: newCount,
        updatedAt: now,
      })
      .where(and(eq(rateLimits.userId, userId), eq(rateLimits.action, action)));

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - newCount),
      resetAt: existing.windowEnd.getTime(),
    };
  });
}
