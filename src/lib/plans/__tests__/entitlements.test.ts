import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { user } from "@/db/schemas/auth";
import { userRepositories } from "@/db/schemas/userRepositories";
import { rateLimits } from "@/db/schemas/rateLimits";
import {
  getUserPlanRecord,
  getUserEntitlements,
  checkRepositoryLimit,
  assertPlanRepositoryEntitlements,
  checkAndConsumeMonthlyQueryQuota,
  rollbackMonthlyQueryQuota,
  getPlanUsage,
  getCalendarMonthWindow,
  RAG_MONTHLY_QUOTA_ACTION,
  isBranchAllowed,
  resolveAndValidateBranch,
  isBossAuthorized,
} from "../entitlements";
import {
  FREE_PLAN_LIMITS,
  HOBBY_PLAN_LIMITS,
  ENTERPRISE_DEFAULT_LIMITS,
  BOSS_PLAN_LIMITS,
  getDefaultEntitlementsForPlan,
  PLAN_PRICING,
} from "../planConfig";

const dialect = new PgDialect();

describe("Plan Entitlements Subsystem", () => {
  let mockDb: any;
  let mockUserRecord: any;
  let mockUserRepositories: any[];
  let mockRateLimits: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRecord = null;
    mockUserRepositories = [];
    mockRateLimits = [];

    mockDb = {
      select: vi.fn().mockImplementation(() => {
        return {
          from: vi.fn().mockImplementation((table: any) => {
            const getResult = () => {
              if (table === user || table?._?.name === "user") {
                return mockUserRecord ? [mockUserRecord] : [];
              }
              if (table === userRepositories || table?._?.name === "user_repositories") {
                return mockUserRepositories;
              }
              if (table === rateLimits || table?._?.name === "rate_limits") {
                return mockRateLimits;
              }
              return [];
            };

            const whereFn = vi.fn().mockImplementation(() => {
              return Object.assign(Promise.resolve(getResult()), {
                limit: vi.fn().mockImplementation(() => Promise.resolve(getResult())),
                for: vi.fn().mockImplementation(() => Promise.resolve(getResult())),
              });
            });

            return Object.assign(Promise.resolve(getResult()), {
              where: whereFn,
            });
          }),
        };
      }),
      insert: vi.fn().mockImplementation(() => {
        return {
          values: vi.fn().mockImplementation((val: any) => {
            return {
              // Mirrors the real atomic counter: `ON CONFLICT DO UPDATE ... RETURNING` evaluates
              // against the stored row and hands back the post-update values.
              onConflictDoUpdate: vi.fn().mockImplementation(({ set }: any) => {
                return {
                  returning: vi.fn().mockImplementation(async () => {
                    // Read the cap out of the rendered statement so this mock cannot drift from
                    // the SQL the implementation actually sends.
                    const rendered = dialect.sqlToQuery(set.count);
                    const cap = Number(rendered.params[rendered.params.length - 1]);

                    const existing = mockRateLimits.find(
                      (r) => r.userId === val.userId && r.action === val.action,
                    );
                    if (!existing) {
                      mockRateLimits.push({ ...val });
                      return [{ ...val, allowed: cap >= 1 }];
                    }

                    const expired = existing.windowEnd.getTime() <= val.updatedAt.getTime();
                    const allowed = expired || existing.count < cap;
                    const nextCount = expired
                      ? 1
                      : existing.count < cap
                        ? existing.count + 1
                        : existing.count;

                    Object.assign(existing, {
                      count: nextCount,
                      windowStart: expired ? val.windowStart : existing.windowStart,
                      windowEnd: expired ? val.windowEnd : existing.windowEnd,
                      updatedAt: val.updatedAt,
                    });

                    return [
                      {
                        count: existing.count,
                        windowEnd: existing.windowEnd,
                        allowed,
                      },
                    ];
                  }),
                };
              }),
            };
          }),
        };
      }),
      update: vi.fn().mockImplementation(() => {
        return {
          set: vi.fn().mockImplementation((updates: any) => {
            return {
              where: vi.fn().mockImplementation(() => {
                if (mockRateLimits.length > 0) {
                  mockRateLimits[0] = { ...mockRateLimits[0], ...updates };
                }
                return Promise.resolve();
              }),
            };
          }),
        };
      }),
      transaction: vi.fn(async (cb: any) => cb(mockDb)),
    };
  });

  describe("Plan Limit Configurations", () => {
    it("defines exact Free plan limits", () => {
      expect(FREE_PLAN_LIMITS.repositoryLimit).toBe(2);
      expect(FREE_PLAN_LIMITS.monthlyQueryLimit).toBe(25);
      expect(FREE_PLAN_LIMITS.repositorySizeLimitBytes).toBe(50 * 1024 * 1024); // 50 MB
      expect(FREE_PLAN_LIMITS.fileLimit).toBe(2500);
      expect(FREE_PLAN_LIMITS.allowedBranch).toBe("main");
      expect(FREE_PLAN_LIMITS.incrementalReindexAllowed).toBe(false);
      expect(PLAN_PRICING.free.displayPrice).toBe("₹0");
    });

    it("defines exact Hobby plan limits", () => {
      expect(HOBBY_PLAN_LIMITS.repositoryLimit).toBe(10);
      expect(HOBBY_PLAN_LIMITS.repositorySizeLimitBytes).toBe(250 * 1024 * 1024); // 250 MB
      expect(HOBBY_PLAN_LIMITS.fileLimit).toBe(12500);
      expect(HOBBY_PLAN_LIMITS.allowedBranch).toBe("*");
      expect(HOBBY_PLAN_LIMITS.incrementalReindexAllowed).toBe(true);
      expect(PLAN_PRICING.hobby.displayPrice).toBe("₹499/month");
      // null means unmetered downstream, so an unset env var must not produce null
      expect(typeof HOBBY_PLAN_LIMITS.monthlyQueryLimit).toBe("number");
    });

    it("allows configurable Hobby monthly query limit", () => {
      const customHobby = getDefaultEntitlementsForPlan("hobby", 200);
      expect(customHobby.monthlyQueryLimit).toBe(200);
    });

    it("supports configurable Enterprise plan entitlements", async () => {
      mockUserRecord = {
        plan: "enterprise",
        customRepositoryLimit: 100,
        customMonthlyQueryLimit: 5000,
        customRepositorySizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
        customFileLimit: 100000,
        customAllowedBranch: "main",
        customIncrementalReindexAllowed: true,
      };

      const entitlements = await getUserEntitlements(mockDb, "user-enterprise");
      expect(entitlements.plan).toBe("enterprise");
      expect(entitlements.repositoryLimit).toBe(100);
      expect(entitlements.monthlyQueryLimit).toBe(5000);
      expect(entitlements.repositorySizeLimitBytes).toBe(2 * 1024 * 1024 * 1024);
      expect(entitlements.fileLimit).toBe(100000);
      expect(entitlements.allowedBranch).toBe("main");
      expect(entitlements.incrementalReindexAllowed).toBe(true);
    });

    it("defaults unknown or missing user plans safely to free", async () => {
      mockUserRecord = null;
      const entitlements = await getUserEntitlements(mockDb, "user-unknown");
      expect(entitlements.plan).toBe("free");
      expect(entitlements.repositoryLimit).toBe(2);
      expect(entitlements.monthlyQueryLimit).toBe(25);
    });
  });

  describe("Repository Limit Enforcement", () => {
    it("Free: rejects 3rd repository when 2 repositories already exist", async () => {
      mockUserRecord = { plan: "free" };
      mockUserRepositories = [{ repositoryId: "repo-1" }, { repositoryId: "repo-2" }];

      const result = await checkRepositoryLimit(mockDb, "user-free");
      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(2);
      expect(result.limit).toBe(2);
    });

    it("Free: allows 1st and 2nd repository", async () => {
      mockUserRecord = { plan: "free" };
      mockUserRepositories = [{ repositoryId: "repo-1" }];

      const result = await checkRepositoryLimit(mockDb, "user-free");
      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(1);
      expect(result.limit).toBe(2);
    });

    it("Hobby: rejects 11th repository when 10 repositories already exist", async () => {
      mockUserRecord = { plan: "hobby" };
      mockUserRepositories = Array.from({ length: 10 }, (_, i) => ({
        repositoryId: `repo-${i + 1}`,
      }));

      const result = await checkRepositoryLimit(mockDb, "user-hobby");
      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(10);
      expect(result.limit).toBe(10);
    });

    it("Hobby: allows repository when under limit", async () => {
      mockUserRecord = { plan: "hobby" };
      mockUserRepositories = Array.from({ length: 9 }, (_, i) => ({
        repositoryId: `repo-${i + 1}`,
      }));

      const result = await checkRepositoryLimit(mockDb, "user-hobby");
      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(9);
      expect(result.limit).toBe(10);
    });

    it("allows re-adding or accessing an already associated repository even if at limit", async () => {
      mockUserRecord = { plan: "free" };
      mockUserRepositories = [{ repositoryId: "repo-1" }, { repositoryId: "repo-2" }];

      // Target repo-2 is already owned by user
      const result = await checkRepositoryLimit(mockDb, "user-free", "repo-2");
      expect(result.allowed).toBe(true);
    });
  });

  describe("Branch, Repository Size, and File Count Assertions", () => {
    it("Free: rejects non-main branch clearly", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(FREE_PLAN_LIMITS, {
          branch: "develop",
          fileCount: 500,
          totalSizeBytes: 10 * 1024 * 1024,
        });
      }).toThrow(/Only the 'main' branch is supported/);
    });

    it("Free: rejects repositories >50 MB", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(FREE_PLAN_LIMITS, {
          branch: "main",
          fileCount: 500,
          totalSizeBytes: 51 * 1024 * 1024, // 51 MB
        });
      }).toThrow(/Repository size \(51.0 MB\) exceeds the limit of 50 MB/);
    });

    it("Free: allows repositories <= 50 MB", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(FREE_PLAN_LIMITS, {
          branch: "main",
          fileCount: 500,
          totalSizeBytes: 50 * 1024 * 1024,
        });
      }).not.toThrow();
    });

    it("Free: rejects repositories >2,500 eligible files", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(FREE_PLAN_LIMITS, {
          branch: "main",
          fileCount: 2501,
          totalSizeBytes: 20 * 1024 * 1024,
        });
      }).toThrow(/exceeding the limit of 2,500 files/);
    });

    it("Free: allows repositories <= 2,500 eligible files", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(FREE_PLAN_LIMITS, {
          branch: "main",
          fileCount: 2500,
          totalSizeBytes: 20 * 1024 * 1024,
        });
      }).not.toThrow();
    });

    it("Hobby: rejects repositories >250 MB", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(HOBBY_PLAN_LIMITS, {
          branch: "main",
          fileCount: 5000,
          totalSizeBytes: 251 * 1024 * 1024, // 251 MB
        });
      }).toThrow(/Repository size \(251.0 MB\) exceeds the limit of 250 MB/);
    });

    it("Hobby: allows repositories <= 250 MB", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(HOBBY_PLAN_LIMITS, {
          branch: "main",
          fileCount: 5000,
          totalSizeBytes: 250 * 1024 * 1024,
        });
      }).not.toThrow();
    });

    it("Hobby: rejects repositories >12,500 eligible files", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(HOBBY_PLAN_LIMITS, {
          branch: "main",
          fileCount: 12501,
          totalSizeBytes: 100 * 1024 * 1024,
        });
      }).toThrow(/exceeding the limit of 12,500 files/);
    });

    it("Hobby: allows repositories <= 12,500 eligible files", () => {
      expect(() => {
        assertPlanRepositoryEntitlements(HOBBY_PLAN_LIMITS, {
          branch: "main",
          fileCount: 12500,
          totalSizeBytes: 100 * 1024 * 1024,
        });
      }).not.toThrow();
    });

    it("Free: blocks incremental reindexing", () => {
      expect(FREE_PLAN_LIMITS.incrementalReindexAllowed).toBe(false);
    });

    it("Hobby: allows incremental reindexing", () => {
      expect(HOBBY_PLAN_LIMITS.incrementalReindexAllowed).toBe(true);
    });
  });

  describe("Monthly Query Quota Enforcement", () => {
    it("Free: rejects 26th monthly query when 25 queries already consumed", async () => {
      const now = new Date("2026-09-15T12:00:00Z");
      const { windowStart, windowEnd } = getCalendarMonthWindow(now);

      mockRateLimits = [
        {
          userId: "user-free",
          action: RAG_MONTHLY_QUOTA_ACTION,
          count: 25,
          windowStart,
          windowEnd,
        },
      ];

      const quota = await checkAndConsumeMonthlyQueryQuota(mockDb, "user-free", 25, now);
      expect(quota.allowed).toBe(false);
      expect(quota.count).toBe(25);
      expect(quota.limit).toBe(25);
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("Free: allows and increments query when under monthly quota", async () => {
      const now = new Date("2026-09-15T12:00:00Z");
      const { windowStart, windowEnd } = getCalendarMonthWindow(now);

      mockRateLimits = [
        {
          userId: "user-free",
          action: RAG_MONTHLY_QUOTA_ACTION,
          count: 24,
          windowStart,
          windowEnd,
        },
      ];

      const quota = await checkAndConsumeMonthlyQueryQuota(mockDb, "user-free", 25, now);
      expect(quota.allowed).toBe(true);
      expect(quota.count).toBe(25);
      expect(quota.limit).toBe(25);
      // The count moves through the atomic upsert, not a follow-up UPDATE.
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockRateLimits[0].count).toBe(25);
    });

    it("resets quota count when entering a new calendar month", async () => {
      const oldMonth = new Date("2026-08-30T12:00:00Z");
      const newMonth = new Date("2026-09-01T00:00:01Z");
      const { windowStart: oldStart, windowEnd: oldEnd } = getCalendarMonthWindow(oldMonth);

      // User used 25 queries in August
      mockRateLimits = [
        {
          userId: "user-free",
          action: RAG_MONTHLY_QUOTA_ACTION,
          count: 25,
          windowStart: oldStart,
          windowEnd: oldEnd,
        },
      ];

      // New request in September resets count to 1
      const quota = await checkAndConsumeMonthlyQueryQuota(mockDb, "user-free", 25, newMonth);
      expect(quota.allowed).toBe(true);
      expect(quota.count).toBe(1);
      expect(quota.limit).toBe(25);
    });

    it("Enterprise/unmetered: allows queries unconditionally when limit is null", async () => {
      const quota = await checkAndConsumeMonthlyQueryQuota(mockDb, "user-ent", null);
      expect(quota.allowed).toBe(true);
      expect(quota.limit).toBeNull();
    });

    it("rolls back consumed query with a single atomic SQL decrement", async () => {
      const now = new Date("2026-09-15T12:00:00Z");
      const { windowStart, windowEnd } = getCalendarMonthWindow(now);

      mockRateLimits = [
        {
          userId: "user-free",
          action: RAG_MONTHLY_QUOTA_ACTION,
          count: 5,
          windowStart,
          windowEnd,
        },
      ];

      let capturedSet: any = null;
      mockDb.update.mockImplementation(() => ({
        set: (updates: any) => {
          capturedSet = updates;
          return { where: vi.fn().mockResolvedValue(undefined) };
        },
      }));

      await rollbackMonthlyQueryQuota(mockDb, "user-free", now);

      expect(capturedSet).not.toBeNull();
      expect(capturedSet.updatedAt).toBe(now);
      // Decrement happens inside SQL (GREATEST(count - 1, 0)), not via read-modify-write,
      // so a concurrent consumption can never be erased by the rollback.
      const literalSql = capturedSet.count.queryChunks
        .map((chunk: any) => (Array.isArray(chunk?.value) ? chunk.value.join("") : chunk?.value ?? ""))
        .join("");
      expect(literalSql).toContain("GREATEST");
    });

    it("propagates quota errors instead of failing open", async () => {
      mockDb.transaction = vi.fn(async () => {
        throw new Error("Database connection lost");
      });

      await expect(
        checkAndConsumeMonthlyQueryQuota(mockDb, "user-free", 25),
      ).rejects.toThrow(/Database connection lost/);
    });
  });

  describe("Concurrency & Race Condition Safety", () => {
    it("consumes quota with a single atomic upsert and no prior row read", async () => {
      const now = new Date("2026-09-15T12:00:00Z");
      await checkAndConsumeMonthlyQueryQuota(mockDb, "user-concurrent", 25, now);
      expect(mockDb.transaction).toHaveBeenCalled();
      // A read-then-write is what lost the race on a user's first request: SELECT ... FOR UPDATE
      // locks nothing when the counter row does not exist, and every conflicting insert reset the
      // count to 1. The counter is now created and incremented in one statement.
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("uses database transactions with row-level locks for repository creation checks", async () => {
      await checkRepositoryLimit(mockDb, "user-concurrent");
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("runs the limit check inside a caller-owned transaction so the lock covers the insert", async () => {
      await checkRepositoryLimit({ select: mockDb.select } as any, "user-concurrent");
      // No transaction on the passed client: checkRepositoryLimit must not open its own,
      // otherwise the user row lock is released before the association insert.
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("propagates repository limit errors instead of failing open", async () => {
      mockDb.transaction = vi.fn(async () => {
        throw new Error("Database connection lost");
      });

      await expect(checkRepositoryLimit(mockDb, "user-free")).rejects.toThrow(
        /Database connection lost/,
      );
    });

    it("simulates concurrent requests arriving at quota boundary: exactly blocks at 25", async () => {
      const now = new Date("2026-09-15T12:00:00Z");
      const { windowStart, windowEnd } = getCalendarMonthWindow(now);

      // One shared counter row, so each statement sees the previous one's committed result.
      mockRateLimits = [
        {
          userId: "user-race",
          action: RAG_MONTHLY_QUOTA_ACTION,
          count: 24,
          windowStart,
          windowEnd,
          updatedAt: now,
        },
      ];

      // 3 concurrent requests fired simultaneously when count is 24 and limit is 25
      const results = await Promise.all([
        checkAndConsumeMonthlyQueryQuota(mockDb, "user-race", 25, now),
        checkAndConsumeMonthlyQueryQuota(mockDb, "user-race", 25, now),
        checkAndConsumeMonthlyQueryQuota(mockDb, "user-race", 25, now),
      ]);

      const allowed = results.filter((r) => r.allowed).length;
      const rejected = results.filter((r) => !r.allowed).length;

      // Exactly 1 allowed to reach 25; the other 2 are rejected without inflating usage.
      expect(allowed).toBe(1);
      expect(rejected).toBe(2);
      expect(mockRateLimits[0].count).toBe(25);
    });

    it("counts every concurrent first request of the month, none reset to 1", async () => {
      const now = new Date("2026-09-15T12:00:00Z");
      mockRateLimits = [];

      // 5 concurrent first requests. The old read-then-write let all 5 see "no row" and each
      // conflicting insert wrote count = 1, so all 5 were allowed on a 3-query quota.
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          checkAndConsumeMonthlyQueryQuota(mockDb, "user-cold-start", 3, now),
        ),
      );

      expect(results.filter((r) => r.allowed).length).toBe(3);
      expect(results.filter((r) => !r.allowed).length).toBe(2);
      expect(mockRateLimits).toHaveLength(1);
      expect(mockRateLimits[0].count).toBe(3);
    });
  });

  describe("Plan Usage Reporting", () => {
    it("reports correct plan usage for dashboard UI", async () => {
      mockUserRecord = { plan: "free" };
      mockUserRepositories = [{ repositoryId: "repo-1" }];
      const now = new Date("2026-09-15T12:00:00Z");
      const { windowStart, windowEnd } = getCalendarMonthWindow(now);
      mockRateLimits = [
        {
          userId: "user-free",
          action: RAG_MONTHLY_QUOTA_ACTION,
          count: 12,
          windowStart,
          windowEnd,
        },
      ];

      const usage = await getPlanUsage(mockDb, "user-free", now);
      expect(usage.plan).toBe("free");
      expect(usage.usage.repositoriesCount).toBe(1);
      expect(usage.usage.monthlyQueriesCount).toBe(12);
      expect(usage.entitlements.repositoryLimit).toBe(2);
      expect(usage.entitlements.monthlyQueryLimit).toBe(25);
      expect(usage.entitlements.fileLimit).toBe(2500);
      expect(usage.entitlements.repositorySizeLimitBytes).toBe(50 * 1024 * 1024);
      expect(usage.entitlements.incrementalReindexAllowed).toBe(false);
    });
  });

  describe("Enterprise Branch Selection and Validation", () => {
    it("Free: only main branch is permitted", () => {
      expect(isBranchAllowed("free", "main", "main")).toBe(true);
      expect(isBranchAllowed("free", "main", "develop")).toBe(false);
      expect(isBranchAllowed("free", "main", "staging")).toBe(false);
    });

    it("Hobby: custom branches are permitted", () => {
      expect(isBranchAllowed("hobby", "*", "main")).toBe(true);
      expect(isBranchAllowed("hobby", "*", "develop")).toBe(true);
      expect(isBranchAllowed("hobby", "*", "release/v1")).toBe(true);
    });

    it("Enterprise: retains safe default main when no custom branch configured", () => {
      expect(isBranchAllowed("enterprise", "main", "main")).toBe(true);
      expect(isBranchAllowed("enterprise", "main", "develop")).toBe(false);

      const branch = resolveAndValidateBranch(ENTERPRISE_DEFAULT_LIMITS, null);
      expect(branch).toBe("main");
    });

    it("Enterprise: allows branch matching configured entitlement", () => {
      const devEntitlements = {
        ...ENTERPRISE_DEFAULT_LIMITS,
        allowedBranch: "develop",
      };

      expect(isBranchAllowed("enterprise", "develop", "develop")).toBe(true);
      expect(isBranchAllowed("enterprise", "develop", "main")).toBe(false);
      expect(isBranchAllowed("enterprise", "develop", "feature-x")).toBe(false);

      const resolved = resolveAndValidateBranch(devEntitlements, "develop");
      expect(resolved).toBe("develop");

      expect(() => resolveAndValidateBranch(devEntitlements, "main")).toThrow(
        /Only the 'develop' branch is supported on your plan/,
      );
    });

    it("Enterprise: allows any branch when wildcard * is configured", () => {
      const wildcardEntitlements = {
        ...ENTERPRISE_DEFAULT_LIMITS,
        allowedBranch: "*",
      };

      expect(isBranchAllowed("enterprise", "*", "main")).toBe(true);
      expect(isBranchAllowed("enterprise", "*", "develop")).toBe(true);
      expect(isBranchAllowed("enterprise", "*", "feature/awesome-ui")).toBe(true);

      const resolved = resolveAndValidateBranch(wildcardEntitlements, "feature/awesome-ui");
      expect(resolved).toBe("feature/awesome-ui");

      // When omitted, returns safe default
      const defaultResolved = resolveAndValidateBranch(wildcardEntitlements, null);
      expect(defaultResolved).toBe("main");
    });

    it("Enterprise: supports comma-separated branch list", () => {
      const multiEntitlements = {
        ...ENTERPRISE_DEFAULT_LIMITS,
        allowedBranch: "main, develop, staging",
      };

      expect(isBranchAllowed("enterprise", "main, develop, staging", "main")).toBe(true);
      expect(isBranchAllowed("enterprise", "main, develop, staging", "develop")).toBe(true);
      expect(isBranchAllowed("enterprise", "main, develop, staging", "staging")).toBe(true);
      expect(isBranchAllowed("enterprise", "main, develop, staging", "prod")).toBe(false);

      const resolvedDev = resolveAndValidateBranch(multiEntitlements, "develop");
      expect(resolvedDev).toBe("develop");

      expect(() => resolveAndValidateBranch(multiEntitlements, "prod")).toThrow(
        /Only the 'main, develop, staging' branch is supported on your plan/,
      );
    });
  });

  describe("BOSS Plan Architecture and Enforcement", () => {
    it("isBossAuthorized validates email and username", () => {
      expect(isBossAuthorized("yrovnit47@gmail.com", null)).toBe(true);
      expect(isBossAuthorized("YROVNIT47@GMAIL.COM", null)).toBe(true);
      expect(isBossAuthorized(null, "yravnit")).toBe(true);
      expect(isBossAuthorized(null, "YRAVNIT")).toBe(true);
      expect(isBossAuthorized("other@gmail.com", "otheruser")).toBe(false);
      expect(isBossAuthorized(null, null)).toBe(false);
    });

    it("automatically grants BOSS plan to yrovnit47@gmail.com", async () => {
      mockUserRecord = {
        id: "boss-user-id",
        email: "yrovnit47@gmail.com",
        name: "Ravnit",
        plan: "free",
      };

      const planRecord = await getUserPlanRecord(mockDb, "boss-user-id");
      expect(planRecord.plan).toBe("boss");
      expect(planRecord.customAllowedBranch).toBe("*");
      expect(planRecord.customRepositoryLimit).toBe(Number.MAX_SAFE_INTEGER);

      const entitlements = await getUserEntitlements(mockDb, "boss-user-id");
      expect(entitlements.plan).toBe("boss");
      expect(entitlements.repositoryLimit).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlements.monthlyQueryLimit).toBeNull();
      expect(entitlements.repositorySizeLimitBytes).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlements.fileLimit).toBe(Number.MAX_SAFE_INTEGER);
      expect(entitlements.allowedBranch).toBe("*");
      expect(entitlements.incrementalReindexAllowed).toBe(true);
    });

    it("automatically grants BOSS plan to github username yravnit", async () => {
      mockUserRecord = {
        id: "boss-user-id-2",
        email: "custom@example.com",
        name: "yravnit",
        plan: "free",
      };

      const entitlements = await getUserEntitlements(mockDb, "boss-user-id-2");
      expect(entitlements.plan).toBe("boss");
      expect(entitlements.allowedBranch).toBe("*");
    });

    it("denies BOSS plan to unauthorized user attempting to spoof boss plan in database", async () => {
      mockUserRecord = {
        id: "imposter-user-id",
        email: "imposter@example.com",
        name: "imposter",
        plan: "boss", // Malicious or unauthorized value
      };

      const planRecord = await getUserPlanRecord(mockDb, "imposter-user-id");
      expect(planRecord.plan).toBe("free");

      const entitlements = await getUserEntitlements(mockDb, "imposter-user-id");
      expect(entitlements.plan).toBe("free");
      expect(entitlements.repositoryLimit).toBe(2);
      expect(entitlements.allowedBranch).toBe("main");
    });

    it("BOSS plan allows any branch, unlimited files, and unlimited repository size", () => {
      expect(isBranchAllowed("boss", "*", "any-custom-branch")).toBe(true);
      expect(isBranchAllowed("boss", "*", "experimental-ai-tree")).toBe(true);

      const resolved = resolveAndValidateBranch(BOSS_PLAN_LIMITS, "feature/hyper-drive");
      expect(resolved).toBe("feature/hyper-drive");

      expect(() => {
        assertPlanRepositoryEntitlements(BOSS_PLAN_LIMITS, {
          branch: "experimental-branch",
          fileCount: 999999,
          totalSizeBytes: 50 * 1024 * 1024 * 1024, // 50 GB
        });
      }).not.toThrow();
    });
  });
});
