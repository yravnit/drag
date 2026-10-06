import { describe, it, expect, vi } from "vitest";

import { claimSyncBatch, settleSyncLease } from "@/lib/leases/repositoryLeases";

/**
 * Builds a plain stub db handle implementing the drizzle chain used by
 * claimSyncBatch: select().from().where().limit().for()
 */
function makeSelectStub(rows: any[]) {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  });
  return select;
}

/**
 * Builds a plain stub db handle implementing the drizzle chain used by
 * the lease updates: update().set().where()
 * Captures the set() argument for assertions.
 */
function makeUpdateStub() {
  const setCalls: any[] = [];
  const update = vi.fn().mockImplementation(() => ({
    set: vi.fn((values: any) => {
      setCalls.push(values);
      return {
        where: vi.fn().mockResolvedValue(undefined),
      };
    }),
  }));
  return { update, setCalls };
}

describe("claimSyncBatch", () => {
  it("returns [] when no repos are due", async () => {
    const select = makeSelectStub([]);
    const { update, setCalls } = makeUpdateStub();
    const database = {
      select,
      update,
      transaction: vi.fn(async (cb: any) => cb({ select, update })),
    } as any;

    const result = await claimSyncBatch(database, 5);

    expect(result).toEqual([]);
    expect(setCalls).toHaveLength(0);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it("returns claimed repos and issues the lease update inside the same transaction", async () => {
    const rows = [
      {
        id: "repo-1",
        owner: "acme",
        name: "widget",
        defaultBranch: "main",
        headCommitSha: null,
      },
      {
        id: "repo-2",
        owner: "acme",
        name: "gadget",
        defaultBranch: "dev",
        headCommitSha: "abc123",
      },
    ];
    const select = makeSelectStub(rows);
    const { update, setCalls } = makeUpdateStub();
    const database = {
      select,
      update,
      transaction: vi.fn(async (cb: any) => cb({ select, update })),
    } as any;

    const before = Date.now();
    const result = await claimSyncBatch(database, 5);
    const after = Date.now();

    expect(result).toEqual(rows);
    expect(database.transaction).toHaveBeenCalledTimes(1);

    // Lease update must mark repos as processing with a ~10 minute expiry
    expect(setCalls).toHaveLength(1);
    const leaseSet = setCalls[0];
    expect(leaseSet.syncStatus).toBe("processing");
    const expiry = leaseSet.syncLeaseExpiresAt as Date;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + 10 * 60 * 1000);
    expect(leaseSet.updatedAt).toBeInstanceOf(Date);
  });

  it("prevents concurrent workers from claiming the same batch", async () => {
    // Simulate a shared repository pool where rows are claimed atomically with FOR UPDATE SKIP LOCKED
    const availableRepos = [
      { id: "repo-1", owner: "acme", name: "repo1", defaultBranch: "main", headCommitSha: null },
      { id: "repo-2", owner: "acme", name: "repo2", defaultBranch: "main", headCommitSha: null },
    ];
    const lockedRows = new Set<string>();

    const createWorkerDb = () => {
      return {
        transaction: async (cb: any) => {
          const tx = {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: (size: number) => ({
                    for: async (_mode: string) => {
                      // Atomically skip locked rows as PostgreSQL FOR UPDATE SKIP LOCKED does
                      const claimable = availableRepos
                        .filter((r) => !lockedRows.has(r.id))
                        .slice(0, size);
                      for (const r of claimable) {
                        lockedRows.add(r.id);
                      }
                      return claimable;
                    },
                  }),
                }),
              }),
            }),
            update: () => ({
              set: (_vals: any) => ({
                where: () => {
                  return Promise.resolve();
                },
              }),
            }),
          };

          return await cb(tx);
        },
      } as any;
    };

    const worker1Db = createWorkerDb();
    const worker2Db = createWorkerDb();

    // Two workers attempt to claim simultaneously
    const [result1, result2] = await Promise.all([
      claimSyncBatch(worker1Db, 2),
      claimSyncBatch(worker2Db, 2),
    ]);

    // All claimed IDs across workers must be disjoint
    const ids1 = result1.map((r) => r.id);
    const ids2 = result2.map((r) => r.id);
    const intersection = ids1.filter((id) => ids2.includes(id));

    expect(intersection).toEqual([]);
    expect(ids1.length + ids2.length).toBe(2);
  });
});

describe("settleSyncLease", () => {
  it("writes completed status, clears the lease, and schedules next sync ~24h ahead", async () => {
    const { update, setCalls } = makeUpdateStub();
    const database = { update } as any;

    const before = Date.now();
    await settleSyncLease(database, "repo-123");
    const after = Date.now();

    expect(update).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(1);

    const settleSet = setCalls[0];
    expect(settleSet.syncStatus).toBe("completed");
    expect(settleSet.syncLeaseExpiresAt).toBeNull();
    const nextSyncAt = settleSet.nextSyncAt as Date;
    expect(nextSyncAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
    expect(nextSyncAt.getTime()).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000);
    expect(settleSet.updatedAt).toBeInstanceOf(Date);
  });
});
