import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelect,
  mockGetUserEntitlements,
  mockGetCommit,
  mockStart,
  mockClaimSyncBatch,
  mockSettleSyncLease,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockGetUserEntitlements: vi.fn(),
  mockGetCommit: vi.fn(),
  mockStart: vi.fn(),
  mockClaimSyncBatch: vi.fn(),
  mockSettleSyncLease: vi.fn(),
}));

vi.mock("@/db/db", () => ({
  db: { select: (...args: any[]) => mockSelect(...args) },
}));

vi.mock("@/lib/plans/entitlements", () => ({
  getUserEntitlements: (...args: any[]) => mockGetUserEntitlements(...args),
}));

vi.mock("@/lib/ingestion/githubApiClient", () => ({
  GitHubApiClient: class {
    getCommit = mockGetCommit;
  },
}));

vi.mock("@/data/serverEnv", () => ({
  serverEnv: { GITHUB_TOKEN: "server-token" },
}));

vi.mock("workflow/api", () => ({
  start: (...args: any[]) => mockStart(...args),
}));

vi.mock("@/lib/leases/repositoryLeases", () => ({
  claimSyncBatch: (...args: any[]) => mockClaimSyncBatch(...args),
  settleSyncLease: (...args: any[]) => mockSettleSyncLease(...args),
}));

import { syncRepositories } from "../sync";

const FREE = {
  plan: "free",
  repositoryLimit: 2,
  monthlyQueryLimit: 25,
  repositorySizeLimitBytes: 1,
  fileLimit: 1,
  allowedBranch: "main",
  incrementalReindexAllowed: false,
};
const HOBBY = { ...FREE, plan: "hobby", incrementalReindexAllowed: true };

/** userRepositories select chain returning the given association rows */
function assocSelect(rows: Array<{ userId: string }>) {
  mockSelect.mockReturnValue({
    from: () => ({
      where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }),
    }),
  });
}

describe("sync incremental-reindex entitlement across shared repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimSyncBatch.mockResolvedValue([
      { id: "repo-1", owner: "acme", name: "widget", defaultBranch: "main", headCommitSha: null },
    ]);
    mockSettleSyncLease.mockResolvedValue(undefined);
    mockGetCommit.mockResolvedValue({ sha: "new-sha" });
    mockStart.mockResolvedValue({ runId: "run-1" });
  });

  it("allows sync when any associated user is entitled and passes that userId to ingest", async () => {
    // A Free user and a Hobby user share the repository. Order must not matter.
    assocSelect([{ userId: "free-user" }, { userId: "hobby-user" }]);
    mockGetUserEntitlements.mockImplementation(async (_db: unknown, userId: string) =>
      userId === "free-user" ? FREE : HOBBY,
    );

    const result = await syncRepositories({ batchSize: 1 });

    expect(result.triggeredCount).toBe(1);
    expect(mockStart).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({ repo: "widget", userId: "hobby-user" }),
    ]);
  });

  it("stops the sync only when no associated user is entitled", async () => {
    assocSelect([{ userId: "free-user-1" }, { userId: "free-user-2" }]);
    mockGetUserEntitlements.mockResolvedValue(FREE);

    const result = await syncRepositories({ batchSize: 1 });

    expect(result.triggeredCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockSettleSyncLease).toHaveBeenCalledWith(expect.anything(), "repo-1");
  });

  it("proceeds for repositories with no associations", async () => {
    assocSelect([]);
    mockGetUserEntitlements.mockResolvedValue(FREE);

    const result = await syncRepositories({ batchSize: 1 });

    expect(result.triggeredCount).toBe(1);
    expect(mockStart).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({ userId: undefined }),
    ]);
  });
});
