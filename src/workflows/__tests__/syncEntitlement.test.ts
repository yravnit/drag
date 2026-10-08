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

/**
 * `claimSyncBatch` returns a full batch once and then reports an empty queue, which is what a
 * real drain looks like: the workflow keeps claiming until a batch comes back short.
 */
function claimOnce(rows: Array<Record<string, unknown>>) {
  let claimed = false;
  mockClaimSyncBatch.mockImplementation(async () => {
    if (claimed) return [];
    claimed = true;
    return rows;
  });
}

describe("sync incremental-reindex entitlement across shared repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimOnce([
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

  it("drains every due batch instead of checking only the first five", async () => {
    // Three full batches of two, then an empty queue: 6 repositories are due.
    const batches = [
      [
        { id: "r1", owner: "a", name: "n1", defaultBranch: "main", headCommitSha: null },
        { id: "r2", owner: "a", name: "n2", defaultBranch: "main", headCommitSha: null },
      ],
      [
        { id: "r3", owner: "a", name: "n3", defaultBranch: "main", headCommitSha: null },
        { id: "r4", owner: "a", name: "n4", defaultBranch: "main", headCommitSha: null },
      ],
      [
        { id: "r5", owner: "a", name: "n5", defaultBranch: "main", headCommitSha: null },
        { id: "r6", owner: "a", name: "n6", defaultBranch: "main", headCommitSha: null },
      ],
    ];
    let index = 0;
    mockClaimSyncBatch.mockImplementation(async () => batches[index++] ?? []);

    assocSelect([]);
    mockGetUserEntitlements.mockResolvedValue(FREE);

    const result = await syncRepositories({ batchSize: 2 });

    // Claiming one batch and returning left repositories 3-6 unchecked until the next daily run.
    expect(result.checkedCount).toBe(6);
    expect(result.triggeredCount).toBe(6);
    expect(mockClaimSyncBatch).toHaveBeenCalledTimes(4);
  });

  it("stops claiming once a batch comes back short", async () => {
    claimOnce([
      { id: "r1", owner: "a", name: "n1", defaultBranch: "main", headCommitSha: null },
      { id: "r2", owner: "a", name: "n2", defaultBranch: "main", headCommitSha: null },
    ]);
    assocSelect([]);
    mockGetUserEntitlements.mockResolvedValue(FREE);

    const result = await syncRepositories({ batchSize: 5 });

    expect(result.checkedCount).toBe(2);
    // A short batch means the due queue is drained, so no further claim is made.
    expect(mockClaimSyncBatch).toHaveBeenCalledTimes(1);
  });
});
