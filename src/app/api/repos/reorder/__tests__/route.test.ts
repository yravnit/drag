import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "../route";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: (...args: any[]) => mockGetSession(...args) } },
}));

/** Every update the route performs, with the values written and the decoded filter. */
const updates: { values: any; filter: { column: string; value: string }[] }[] = [];
const mockTransaction = vi.fn();

vi.mock("@/db/db", () => ({
  db: {
    update: () => ({
      set: (values: any) => ({
        where: vi.fn(async (...whereArgs: any[]) => {
          updates.push({ values, filter: whereArgs[0].and });
        }),
      }),
    }),
    transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

vi.mock("@/db/schema", () => ({
  userRepositories: {
    id: "ur_id",
    userId: "ur_userId",
    repositoryId: "ur_repositoryId",
    sortOrder: "ur_sortOrder",
  },
}));

// `and`/`eq` are mocked as plain object builders so a test can read the filter a write carried.
vi.mock("drizzle-orm", () => ({
  and: (...conditions: any[]) => ({ and: conditions }),
  eq: (column: any, value: any) => ({ column, value }),
}));

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/repos/reorder", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

/** The repository id a write targeted, read back out of its filter. */
function writtenId(update: { filter: { column: string; value: string }[] }): string {
  return update.filter.find((c) => c.column === "ur_repositoryId")!.value;
}

describe("PATCH /api/repos/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    mockTransaction.mockImplementation(async (cb: any) =>
      cb({
        update: () => ({
          set: (values: any) => ({
            where: vi.fn(async (...whereArgs: any[]) => {
              updates.push({ values, filter: whereArgs[0].and });
            }),
          }),
        }),
      }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await patch({ orderedIds: ["repo-a"] });
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("rejects a body that is not an array of ids", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    expect((await patch({ orderedIds: "repo-a" })).status).toBe(400);
    expect((await patch({ orderedIds: [1, 2] })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("rejects malformed JSON", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await PATCH(
      new Request("http://localhost/api/repos/reorder", { method: "PATCH", body: "{" }),
    );
    expect(res.status).toBe(400);
  });

  it("writes a dense total order 0..n-1 in the order the client sent", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await patch({ orderedIds: ["repo-b", "repo-a", "repo-c"] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // Dense and gap-free, one distinct position per id — not a row left sitting at its default 0.
    expect(updates.map((u) => [writtenId(u), u.values.sortOrder])).toEqual([
      ["repo-b", 0],
      ["repo-a", 1],
      ["repo-c", 2],
    ]);
    // One transaction: a half-applied reorder would show an order the user never asked for.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("scopes every write to the caller's userId, so a foreign id matches nothing", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    await patch({ orderedIds: ["repo-b", "somebody-elses-repo"] });

    // The userId predicate is what makes a forged id a no-op rather than a cross-tenant write:
    // the row is not the caller's, so `WHERE` excludes it.
    for (const update of updates) {
      expect(update.filter.find((c) => c.column === "ur_userId")?.value).toBe("user-1");
    }
  });

  it("returns 500 when the transaction throws", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockTransaction.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await patch({ orderedIds: ["repo-a"] });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to reorder repositories");
  });
});