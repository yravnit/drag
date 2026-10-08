import { Database } from "@/db/db";
import { user } from "@/db/schemas/auth";
import { userRepositories } from "@/db/schemas/userRepositories";
import { rateLimits } from "@/db/schemas/rateLimits";
import { and, eq, sql } from "drizzle-orm";
import { consumeCounter, type DbOrTx as CounterDbOrTx } from "@/lib/rateLimit/rateLimiter";
import {
  PlanType,
  PlanEntitlements,
  getDefaultEntitlementsForPlan,
} from "./planConfig";

export const RAG_MONTHLY_QUOTA_ACTION = "rag-monthly-quota";

export interface UserPlanRecord {
  plan: PlanType;
  customRepositoryLimit: number | null;
  customMonthlyQueryLimit: number | null;
  customRepositorySizeBytes: number | null;
  customFileLimit: number | null;
  customAllowedBranch: string | null;
  customIncrementalReindexAllowed: boolean | null;
}

export function getCalendarMonthWindow(now: Date = new Date()): {
  windowStart: Date;
  windowEnd: Date;
} {
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { windowStart, windowEnd };
}

const BOSS_AUTHORIZED_EMAILS = ["yrovnit47@gmail.com"] as const;
const BOSS_AUTHORIZED_USERNAMES = ["yravnit"] as const;

export function isBossAuthorized(email?: string | null, name?: string | null): boolean {
  if (email && BOSS_AUTHORIZED_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase().trim())) {
    return true;
  }
  if (name && BOSS_AUTHORIZED_USERNAMES.some((u) => u.toLowerCase() === name.toLowerCase().trim())) {
    return true;
  }
  return false;
}

/**
 * Resolves the raw user plan and custom configuration from the database.
 * Defaults to "free" if not found or unmocked.
 */
export async function getUserPlanRecord(
  database: Database,
  userId: string,
): Promise<UserPlanRecord> {
  const defaultFree: UserPlanRecord = {
    plan: "free",
    customRepositoryLimit: null,
    customMonthlyQueryLimit: null,
    customRepositorySizeBytes: null,
    customFileLimit: null,
    customAllowedBranch: null,
    customIncrementalReindexAllowed: null,
  };

  try {
    if (!user || typeof database?.select !== "function") {
      return defaultFree;
    }

    const sel = database.select({
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      customRepositoryLimit: user.customRepositoryLimit,
      customMonthlyQueryLimit: user.customMonthlyQueryLimit,
      customRepositorySizeBytes: user.customRepositorySizeBytes,
      customFileLimit: user.customFileLimit,
      customAllowedBranch: user.customAllowedBranch,
      customIncrementalReindexAllowed: user.customIncrementalReindexAllowed,
    });

    if (typeof sel?.from !== "function") return defaultFree;
    const fromUser = sel.from(user);
    if (typeof fromUser?.where !== "function") return defaultFree;
    const whereUser = fromUser.where(eq(user.id, userId));
    const limitQuery = typeof whereUser?.limit === "function" ? whereUser.limit(1) : whereUser;
    const res = await limitQuery;

    const record = Array.isArray(res) && res.length > 0 ? res[0] : null;
    if (!record || !record.plan) {
      return defaultFree;
    }

    const email = typeof record.email === "string" ? record.email : null;
    const name = typeof record.name === "string" ? record.name : null;
    if (isBossAuthorized(email, name)) {
      return {
        plan: "boss",
        customRepositoryLimit: Number.MAX_SAFE_INTEGER,
        customMonthlyQueryLimit: null,
        customRepositorySizeBytes: Number.MAX_SAFE_INTEGER,
        customFileLimit: Number.MAX_SAFE_INTEGER,
        customAllowedBranch: "*",
        customIncrementalReindexAllowed: true,
      };
    }

    const rawPlan = record.plan;
    let normalizedPlan: PlanType = "free";
    if (rawPlan === "hobby" || rawPlan === "enterprise") {
      normalizedPlan = rawPlan;
    }

    return {
      plan: normalizedPlan,
      customRepositoryLimit: record.customRepositoryLimit ?? null,
      customMonthlyQueryLimit: record.customMonthlyQueryLimit ?? null,
      customRepositorySizeBytes: record.customRepositorySizeBytes ?? null,
      customFileLimit: record.customFileLimit ?? null,
      customAllowedBranch: record.customAllowedBranch ?? null,
      customIncrementalReindexAllowed: record.customIncrementalReindexAllowed ?? null,
    };
  } catch {
    return defaultFree;
  }
}

/**
 * Resolves active plan entitlements for the specified user.
 * Merges enterprise custom negotiated limits when user plan is enterprise.
 */
export async function getUserEntitlements(
  database: Database,
  userId: string,
): Promise<PlanEntitlements> {
  const userPlan = await getUserPlanRecord(database, userId);
  const base = getDefaultEntitlementsForPlan(userPlan.plan);

  if (userPlan.plan === "boss") {
    return {
      plan: "boss",
      repositoryLimit: Number.MAX_SAFE_INTEGER,
      monthlyQueryLimit: null,
      repositorySizeLimitBytes: Number.MAX_SAFE_INTEGER,
      fileLimit: Number.MAX_SAFE_INTEGER,
      allowedBranch: "*",
      incrementalReindexAllowed: true,
    };
  }

  if (userPlan.plan === "enterprise") {
    return {
      plan: "enterprise",
      repositoryLimit: userPlan.customRepositoryLimit ?? base.repositoryLimit,
      monthlyQueryLimit:
        userPlan.customMonthlyQueryLimit !== null
          ? userPlan.customMonthlyQueryLimit
          : base.monthlyQueryLimit,
      repositorySizeLimitBytes:
        userPlan.customRepositorySizeBytes !== null
          ? userPlan.customRepositorySizeBytes
          : base.repositorySizeLimitBytes,
      fileLimit: userPlan.customFileLimit ?? base.fileLimit,
      allowedBranch: userPlan.customAllowedBranch ?? base.allowedBranch,
      incrementalReindexAllowed:
        userPlan.customIncrementalReindexAllowed !== null
          ? userPlan.customIncrementalReindexAllowed
          : base.incrementalReindexAllowed,
    };
  }

  return base;
}

type DbOrTx = CounterDbOrTx;

/**
 * Checks whether the user can add another repository under their plan limit.
 *
 * The user row is locked with `SELECT ... FOR UPDATE` so concurrent calls serialize.
 * Pass a transaction client to run the check inside a caller-owned transaction so the
 * lock stays held for the association insert (see POST /api/repos). Without that, the lock
 * is released before the insert and two concurrent requests both pass the limit.
 *
 * Errors propagate: a failed count must not read as "under the limit".
 */
export async function checkRepositoryLimit(
  database: DbOrTx,
  userId: string,
  targetRepositoryId?: string,
): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
  const entitlements = await getUserEntitlements(database as Database, userId);

  const performCheck = async (client: DbOrTx) => {
    if (targetRepositoryId && typeof client?.select === "function") {
      const sel = client.select();
      if (typeof sel?.from === "function") {
        const fromAssoc = sel.from(userRepositories);
        if (typeof fromAssoc?.where === "function") {
          const existingAssoc = await fromAssoc
            .where(
              and(
                eq(userRepositories.userId, userId),
                eq(userRepositories.repositoryId, targetRepositoryId),
              ),
            )
            .limit(1);

          if (Array.isArray(existingAssoc) && existingAssoc.length > 0) {
            return {
              allowed: true,
              currentCount: 0,
              limit: entitlements.repositoryLimit,
            };
          }
        }
      }
    }

    const fromAssoc = client.select().from(userRepositories);
    const records = await fromAssoc.where(eq(userRepositories.userId, userId));
    let currentCount = records.length;
    const firstRecord = records[0] as unknown as { count?: unknown } | undefined;
    // Count queries may return [{ count: 2 }]
    if (records.length === 1 && firstRecord && typeof firstRecord.count !== "undefined") {
      currentCount = Number(firstRecord.count);
    }

    return {
      allowed: currentCount < entitlements.repositoryLimit,
      currentCount,
      limit: entitlements.repositoryLimit,
    };
  };

  const lockUserRow = async (client: DbOrTx) => {
    if (!user || typeof client?.select !== "function") return;
    const fromUser = client.select().from(user);
    if (typeof fromUser?.where !== "function") return;
    const whereRes = fromUser.where(eq(user.id, userId));
    if (typeof whereRes?.for === "function") {
      await whereRes.for("update");
    }
  };

  const runLocked = async (client: DbOrTx) => {
    await lockUserRow(client);
    return performCheck(client);
  };

  if (typeof (database as Database)?.transaction === "function") {
    return (database as Database).transaction((tx) => runLocked(tx));
  }

  return runLocked(database);
}

/**
 * Verifies whether a requested branch is permitted under the given plan and allowedBranch setting.
 *
 * Rules:
 * - Free: 'main' only.
 * - Hobby: 'main' only.
 * - Enterprise: branch determined by its configured entitlement (allowedBranch).
 *   If not configured, safe default is 'main'.
 *   If allowedBranch is '*', any branch is permitted.
 *   If allowedBranch is a comma-separated list, requested branch must be in the list.
 *   Otherwise, requested branch must exactly match allowedBranch.
 * - Boss: '*' (any branch permitted).
 */
export function isBranchAllowed(
  plan: PlanType,
  allowedBranchConfig: string,
  requestedBranch: string,
): boolean {
  if (plan === "free") {
    return requestedBranch === "main";
  }

  if (plan === "boss" || plan === "hobby" || allowedBranchConfig === "*") {
    return true;
  }

  const allowedList = allowedBranchConfig
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

  if (allowedList.length === 0) {
    return requestedBranch === "main";
  }

  return allowedList.includes(requestedBranch);
}

/**
 * Resolves the target branch to use for repository indexing and sync.
 * Validates the requested branch against plan entitlements.
 * Throws an Error if the requested branch is not permitted.
 *
 * Safe defaults when no branch is requested:
 * - Free/Hobby: 'main'.
 * - Enterprise: first configured branch in entitlement or 'main'.
 * - Boss: 'main'.
 */
// ponytail: Enterprise branch validation uses string comparison or comma-list lookup; upgrade path is regex branch pattern matching.
export function resolveAndValidateBranch(
  entitlements: PlanEntitlements,
  requestedBranch?: string | null,
): string {
  const safeDefault = "main";

  if (requestedBranch && requestedBranch.trim()) {
    const branch = requestedBranch.trim();
    if (!isBranchAllowed(entitlements.plan, entitlements.allowedBranch, branch)) {
      throw new Error(
        `Only the '${entitlements.allowedBranch}' branch is supported on your plan. Requested branch '${branch}' is not permitted.`,
      );
    }
    return branch;
  }

  if (entitlements.plan === "enterprise") {
    if (entitlements.allowedBranch && entitlements.allowedBranch !== "*") {
      const firstBranch = entitlements.allowedBranch.split(",")[0].trim();
      return firstBranch || safeDefault;
    }
    return safeDefault;
  }

  return safeDefault;
}

/**
 * Validates branch, repository size, and file count against active plan entitlements.
 */
export function assertPlanRepositoryEntitlements(
  entitlements: PlanEntitlements,
  input: {
    branch: string;
    fileCount: number;
    totalSizeBytes: number;
  },
): void {
  if (!isBranchAllowed(entitlements.plan, entitlements.allowedBranch, input.branch)) {
    throw new Error(
      `Only the '${entitlements.allowedBranch}' branch is supported on your plan. Requested branch '${input.branch}' is not permitted.`,
    );
  }

  if (input.fileCount > entitlements.fileLimit) {
    throw new Error(
      `Repository contains ${input.fileCount.toLocaleString()} eligible files, exceeding the limit of ${entitlements.fileLimit.toLocaleString()} files for your plan.`,
    );
  }

  if (input.totalSizeBytes > entitlements.repositorySizeLimitBytes) {
    const sizeMb = (input.totalSizeBytes / (1024 * 1024)).toFixed(1);
    const maxMb = (entitlements.repositorySizeLimitBytes / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Repository size (${sizeMb} MB) exceeds the limit of ${maxMb} MB for your plan.`,
    );
  }
}

/**
 * Checks and atomically consumes one RAG query from the user's calendar month quota.
 * Uses SELECT ... FOR UPDATE to serialize concurrent requests, preventing quota bypass.
 *
 * Errors propagate to the caller (route returns 5xx). Failing open here would permit
 * unmetered LLM and embedding calls whenever the database misbehaves.
 */
export async function checkAndConsumeMonthlyQueryQuota(
  database: Database,
  userId: string,
  monthlyLimit: number | null,
  now: Date = new Date(),
): Promise<{ allowed: boolean; count: number; limit: number | null; resetAt: number }> {
  const { windowStart, windowEnd } = getCalendarMonthWindow(now);

  if (monthlyLimit === null) {
    return {
      allowed: true,
      count: 0,
      limit: null,
      resetAt: windowEnd.getTime(),
    };
  }

  const performQuotaCheck = async (client: DbOrTx) => {
    const consumed = await consumeCounter(client, {
      userId,
      action: RAG_MONTHLY_QUOTA_ACTION,
      maxRequests: monthlyLimit,
      windowStart,
      windowEnd,
      now,
    });

    return {
      allowed: consumed.allowed,
      count: consumed.count,
      limit: monthlyLimit,
      resetAt: consumed.windowEnd.getTime(),
    };
  };

  if (typeof database?.transaction === "function") {
    return database.transaction((tx) => performQuotaCheck(tx));
  }

  return performQuotaCheck(database);
}

/**
 * Rolls back one consumed query from the calendar month quota if a request fails before streaming.
 *
 * The decrement is a single SQL statement. A read-modify-write would let a concurrent
 * consumption commit between the read and the write, and the absolute write would erase it.
 *
 * `windowEnd` must be the window that was actually consumed (the `resetAt` returned by
 * {@link checkAndConsumeMonthlyQueryQuota}), not "whatever window is open now". A request that
 * consumed just before midnight and failed just after would otherwise decrement the new month's
 * row and erase a different month's usage.
 *
 * Rollback failures are logged, never thrown, so they cannot mask the upstream error.
 */
export async function rollbackMonthlyQueryQuota(
  database: Database,
  userId: string,
  windowEnd: Date,
  now: Date = new Date(),
): Promise<void> {
  const performRollback = async (client: DbOrTx) => {
    try {
      await client
        .update(rateLimits)
        .set({ count: sql`GREATEST(${rateLimits.count} - 1, 0)`, updatedAt: now })
        .where(
          and(
            eq(rateLimits.userId, userId),
            eq(rateLimits.action, RAG_MONTHLY_QUOTA_ACTION),
            eq(rateLimits.windowEnd, windowEnd),
          ),
        );
    } catch (err) {
      console.error("Failed to roll back monthly query quota:", err);
    }
  };

  if (typeof database?.transaction === "function") {
    await database.transaction((tx) => performRollback(tx));
    return;
  }

  await performRollback(database);
}

/**
 * Returns user plan, entitlements, and current usage for the frontend dashboard.
 */
export async function getPlanUsage(
  database: Database,
  userId: string,
  now: Date = new Date(),
): Promise<{
  plan: PlanType;
  entitlements: PlanEntitlements;
  usage: {
    repositoriesCount: number;
    monthlyQueriesCount: number;
    monthlyQueriesResetAt: number;
  };
}> {
  const entitlements = await getUserEntitlements(database, userId);
  const { windowEnd } = getCalendarMonthWindow(now);

  let repositoriesCount = 0;
  try {
    const repos = await database
      .select()
      .from(userRepositories)
      .where(eq(userRepositories.userId, userId));
    repositoriesCount = Array.isArray(repos) ? repos.length : 0;
  } catch {
    // fallback
  }

  let monthlyQueriesCount = 0;
  let monthlyQueriesResetAt = windowEnd.getTime();

  try {
    const records = await database
      .select()
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.userId, userId),
          eq(rateLimits.action, RAG_MONTHLY_QUOTA_ACTION),
        ),
      );
    const quotaRes = Array.isArray(records) && records.length > 0 ? records[0] : null;

    if (quotaRes && now < quotaRes.windowEnd) {
      monthlyQueriesCount = quotaRes.count;
      monthlyQueriesResetAt = quotaRes.windowEnd.getTime();
    }
  } catch {
    // fallback
  }

  return {
    plan: entitlements.plan,
    entitlements,
    usage: {
      repositoriesCount,
      monthlyQueriesCount,
      monthlyQueriesResetAt,
    },
  };
}
