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
  conversations: {
    id: "conv_id",
    userId: "conv_userId",
    repositoryId: "conv_repositoryId",
    sortOrder: "conv_sortOrder",
  },
}));

// `and`/`eq` are mocked as plain object builders so a test can read the filter a write carried.
vi.mock("drizzle-orm", () => ({
  and: (...conditions: any[]) => ({ and: conditions }),
  eq: (column: any, value: any) => ({ column, value }),
}));

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/conversations/reorder", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

function writtenId(update: { filter: { column: string; value: string }[] }): string {
  return update.filter.find((c) => c.column === "conv_id")!.value;
}

describe("PATCH /api/conversations/reorder", () => {
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
    const res = await patch({ repositoryId: "repo-1", orderedIds: ["c-1"] });
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("rejects a missing repositoryId and a non-array orderedIds", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    expect((await patch({ orderedIds: ["c-1"] })).status).toBe(400);
    expect((await patch({ repositoryId: "  ", orderedIds: ["c-1"] })).status).toBe(400);
    expect((await patch({ repositoryId: "repo-1", orderedIds: "c-1" })).status).toBe(400);
    expect((await patch({ repositoryId: "repo-1", orderedIds: [{ id: "c-1" }] })).status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("rejects malformed JSON", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await PATCH(
      new Request("http://localhost/api/conversations/reorder", {
        method: "PATCH",
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("writes a dense total order 0..n-1 in the order the client sent", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await patch({ repositoryId: "repo-1", orderedIds: ["c-3", "c-1", "c-2"] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(updates.map((u) => [writtenId(u), u.values.sortOrder])).toEqual([
      ["c-3", 0],
      ["c-1", 1],
      ["c-2", 2],
    ]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("scopes every write to the caller's userId and the given repositoryId", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    await patch({ repositoryId: "repo-9", orderedIds: ["c-1", "somebody-elses-conversation"] });

    // Both predicates are load-bearing: userId keeps a forged id off another tenant's row, and
    // repositoryId keeps a thread from being dragged between repositories by a forged payload.
    for (const update of updates) {
      const byColumn = new Map(update.filter.map((c) => [c.column, c.value]));
      expect(byColumn.get("conv_userId")).toBe("user-1");
      expect(byColumn.get("conv_repositoryId")).toBe("repo-9");
    }
  });

  it("returns 500 when the transaction throws", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockTransaction.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await patch({ repositoryId: "repo-1", orderedIds: ["c-1"] });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to reorder conversations");
  });
});