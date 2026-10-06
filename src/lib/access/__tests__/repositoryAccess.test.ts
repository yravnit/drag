import { describe, it, expect, vi } from "vitest";
import {
  verifyRepositoryAccess,
  assertRepositoryAssociation,
  invalidateRepositoryAccessCache,
} from "../repositoryAccess";

vi.mock("@/lib/ingestion/githubApiClient", () => ({
  GitHubApiClient: class {
    getRepository = vi.fn();
  },
}));

interface UpsertCapture {
  values: Record<string, unknown>;
  onConflict: unknown;
}

function makeStubDb(selectQueue: Array<Promise<any[]>>) {
  const selectCalls: any[][] = [];
  const upserts: UpsertCapture[] = [];
  const deletes: unknown[] = [];

  const db = {
    select: (...args: any[]) => {
      selectCalls.push(args);
      const result = selectQueue.shift() ?? Promise.resolve([]);
      return {
        from: (_table: unknown) => ({
          where: (_cond: unknown) => ({
            limit: async () => await result,
          }),
        }),
      };
    },
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (conflict: unknown) => {
          upserts.push({ values, onConflict: conflict });
          return Promise.resolve(undefined);
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: (cond: unknown) => {
        deletes.push(cond);
        return Promise.resolve(undefined);
      },
    }),
  };

  return { db, selectCalls, upserts, deletes };
}

const baseParams = {
  userId: "user-1",
  repositoryId: "repo-1",
  owner: "owner-1",
  name: "repo-name",
};

describe("verifyRepositoryAccess", () => {
  it("returns cached.hasAccess on a fresh cache hit without touching GitHub", async () => {
    const { db, upserts } = makeStubDb([
      Promise.resolve([
        {
          userId: "user-1",
          repositoryId: "repo-1",
          hasAccess: true,
          verifiedAt: new Date(),
        },
      ]),
    ]);
    const getGithubToken = vi.fn();
    const createGithubClient = vi.fn();

    const result = await verifyRepositoryAccess(
      db as any,
      baseParams,
      { getGithubToken, createGithubClient },
    );

    expect(result).toEqual({ hasAccess: true });
    expect(getGithubToken).not.toHaveBeenCalled();
    expect(createGithubClient).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("re-verifies on stale cache: token + successful getRepository -> true and upsert with true", async () => {
    const oneHourAndAHalfAgo = new Date(Date.now() - 90 * 60 * 1000);
    const { db, upserts } = makeStubDb([
      Promise.resolve([
        {
          userId: "user-1",
          repositoryId: "repo-1",
          hasAccess: true,
          verifiedAt: oneHourAndAHalfAgo,
        },
      ]),
    ]);
    const getRepository = vi.fn().mockResolvedValue({ id: 1 });
    const createGithubClient = vi.fn(() => ({ getRepository }));

    const result = await verifyRepositoryAccess(
      db as any,
      baseParams,
      {
        getGithubToken: () => Promise.resolve("token-123"),
        createGithubClient,
      },
    );

    expect(result).toEqual({ hasAccess: true });
    expect(createGithubClient).toHaveBeenCalledWith("token-123");
    expect(getRepository).toHaveBeenCalledWith("owner-1", "repo-name");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values).toMatchObject({
      userId: "user-1",
      repositoryId: "repo-1",
      hasAccess: true,
    });
    expect((upserts[0].onConflict as any).set).toMatchObject({ hasAccess: true });
  });

  it("re-verify failure (getRepository rejects) -> false + upsert with false", async () => {
    const { db, upserts } = makeStubDb([Promise.resolve([])]);
    const getRepository = vi.fn().mockRejectedValue(new Error("Not Found"));

    const result = await verifyRepositoryAccess(db as any, baseParams, {
      getGithubToken: () => Promise.resolve("token-123"),
      createGithubClient: () => ({ getRepository }),
    });

    expect(result).toEqual({ hasAccess: false });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values.hasAccess).toBe(false);
    expect((upserts[0].onConflict as any).set.hasAccess).toBe(false);
  });

  it("missing token -> false + upsert with false without creating a client", async () => {
    const { db, upserts } = makeStubDb([Promise.resolve([])]);
    const createGithubClient = vi.fn();

    const result = await verifyRepositoryAccess(db as any, baseParams, {
      getGithubToken: () => Promise.resolve(null),
      createGithubClient,
    });

    expect(result).toEqual({ hasAccess: false });
    expect(createGithubClient).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values.hasAccess).toBe(false);
    expect((upserts[0].onConflict as any).set.hasAccess).toBe(false);
  });

  it("respects a custom cacheTtlMs for freshness", async () => {
    // Cache entry verified 10 minutes ago; TTL of 5 minutes makes it stale.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const { db, upserts } = makeStubDb([
      Promise.resolve([{ hasAccess: true, verifiedAt: tenMinutesAgo }]),
    ]);
    const getRepository = vi.fn().mockResolvedValue({});

    const result = await verifyRepositoryAccess(
      db as any,
      baseParams,
      {
        getGithubToken: () => Promise.resolve("token-123"),
        createGithubClient: () => ({ getRepository }),
        cacheTtlMs: 5 * 60 * 1000,
      },
    );

    expect(result).toEqual({ hasAccess: true });
    expect(upserts).toHaveLength(1);
  });
});

describe("assertRepositoryAssociation", () => {
  it("returns true when an association row exists", async () => {
    const { db } = makeStubDb([
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1" }]),
    ]);

    const result = await assertRepositoryAssociation(db as any, "user-1", "repo-1");

    expect(result).toBe(true);
  });

  it("returns false when no association row exists", async () => {
    const { db } = makeStubDb([Promise.resolve([])]);

    const result = await assertRepositoryAssociation(db as any, "user-1", "repo-1");

    expect(result).toBe(false);
  });
});

describe("invalidateRepositoryAccessCache", () => {
  it("deletes cache entry for specific user and repository", async () => {
    const { db, deletes } = makeStubDb([]);

    await invalidateRepositoryAccessCache(db as any, "user-1", "repo-1");

    expect(deletes).toHaveLength(1);
  });

  it("deletes all cache entries for user when repositoryId is omitted", async () => {
    const { db, deletes } = makeStubDb([]);

    await invalidateRepositoryAccessCache(db as any, "user-1");

    expect(deletes).toHaveLength(1);
  });
});

