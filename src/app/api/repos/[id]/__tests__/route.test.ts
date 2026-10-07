import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

/** Associations still present when the count is taken inside the transaction. */
let mockRemainingAssociations = 1;

vi.mock("@/db/db", () => {
  // Captures the ordering of writes inside the transaction, which is the whole point of the fix:
  // the count must be re-read after the delete, while the row lock is held.
  const calls: string[] = [];

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(async () => {
            calls.push("lock");
            return [{ id: "repo-1" }];
          }),
          // The count select awaits directly rather than through .for()
          then: (resolve: any) =>
            Promise.resolve().then(() => {
              calls.push("count");
              return resolve([{ value: mockRemainingAssociations }]);
            }),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        calls.push("delete");
      }),
    })),
  };

  return {
    calls,
    db: {
      transaction: vi.fn(async (cb: any) => cb(tx)),
      delete: tx.delete,
      select: tx.select,
    },
  };
});

const mockInvalidateCache = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/access/repositoryAccess", () => ({
  invalidateRepositoryAccessCache: (...args: any[]) => mockInvalidateCache(...args),
}));

async function importRoute() {
  return await import("../route");
}

async function runDelete() {
  const { DELETE: handler } = await importRoute();
  const request = new Request("http://localhost/api/repos/repo-1", { method: "DELETE" });
  return await handler(request, { params: Promise.resolve({ id: "repo-1" }) });
}

describe("DELETE /api/repos/[id]", () => {
  let dbModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRemainingAssociations = 1;
    dbModule = await import("@/db/db");
    dbModule.calls.length = 0;
  });

  it("returns 401 if user is not authenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const response = await runDelete();

    expect(response.status).toBe(401);
    expect(mockInvalidateCache).not.toHaveBeenCalled();
    expect(dbModule.calls).toEqual([]);
  });

  it("removes association and invalidates access cache", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const response = await runDelete();

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    expect(mockInvalidateCache).toHaveBeenCalledWith(expect.anything(), "user-1", "repo-1");
  });

  it("takes the repository lock before deleting the association", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    await runDelete();

    // A concurrent POST /api/repos blocks on the same lock, so it cannot attach a repository
    // between this user's delete and the count below.
    expect(dbModule.calls[0]).toBe("lock");
    expect(dbModule.calls.indexOf("count")).toBeGreaterThan(0);
  });

  it("recounts associations after the delete, not before", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    await runDelete();

    const deleteIdx = dbModule.calls.indexOf("delete");
    const countIdx = dbModule.calls.indexOf("count");
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(deleteIdx);
  });

  it("deletes the repository only when the recount finds no remaining association", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockRemainingAssociations = 1;

    const response = await runDelete();

    const data = await response.json();
    expect(data.deleted).toBe(false);
    // Only two deletes: the association and this user's conversations. No repository delete.
    expect(dbModule.calls.filter((c: string) => c === "delete")).toHaveLength(2);
  });

  it("deletes the repository when the recount finds zero associations", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockRemainingAssociations = 0;

    const response = await runDelete();

    const data = await response.json();
    expect(data.deleted).toBe(true);
    expect(dbModule.calls.filter((c: string) => c === "delete")).toHaveLength(3);
  });

  it("runs the whole detach inside one transaction", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    await runDelete();

    expect(dbModule.db.transaction).toHaveBeenCalledTimes(1);
  });
});
