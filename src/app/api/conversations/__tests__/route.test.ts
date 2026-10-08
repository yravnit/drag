import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "../route";
import { asc } from "drizzle-orm";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: (...args: any[]) => mockGetSession(...args) } },
}));

vi.mock("@/lib/access/repositoryAccess", () => ({
  assertRepositoryAssociation: vi.fn().mockResolvedValue(true),
}));

/** Rows the fake select returns, plus the `orderBy` columns it was asked for. */
let selectRows: any[] = [];
const mockOrderBy = vi.fn();
vi.mock("@/db/db", () => ({
  db: {
    select: () => {
      const terminal = () =>
        Object.assign(Promise.resolve(selectRows), {
          orderBy: (...args: any[]) => {
            mockOrderBy(...args);
            return Promise.resolve(selectRows);
          },
        });
      return {
        from: () => ({ where: () => terminal() }),
      };
    },
    insert: () => ({
      values: (values: any) => {
        mockInserted = values;
        return { returning: async () => [{ id: "c-new", title: values.title }] };
      },
    }),
  },
}));

let mockInserted: any = null;

vi.mock("@/db/schema", () => ({
  conversations: {
    id: "conv_id",
    userId: "conv_userId",
    repositoryId: "conv_repositoryId",
    title: "conv_title",
    createdAt: "conv_createdAt",
    sortOrder: "conv_sortOrder",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn((column: unknown) => ({ asc: column })),
  eq: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), ""),
    { raw: (strings: TemplateStringsArray) => strings.join("?") },
  ),
}));

function listRequest(url = "http://localhost/api/conversations?repositoryId=repo-1") {
  return new Request(url, { method: "GET" });
}

describe("GET /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows = [];
    mockInserted = null;
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await GET(listRequest())).status).toBe(401);
  });

  it("returns 400 without a repositoryId", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    const res = await GET(new Request("http://localhost/api/conversations"));
    expect(res.status).toBe(400);
  });

  it("orders by the user's persisted sortOrder ascending, with id as the stable tiebreak", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await GET(listRequest());

    expect(res.status).toBe(200);
    // Ascending by sortOrder, then id. Sorting by createdAt DESC would put a dragged-to-top thread
    // straight back to the bottom, and leaving the tiebreak out lets equal sortOrder values
    // (every row created before ordering existed) come back in an arbitrary order per request.
    expect(vi.mocked(asc).mock.calls.map(([column]) => column)).toEqual([
      "conv_sortOrder",
      "conv_id",
    ]);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
  });

  it("serves the rows in the order the database returned them", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    // Whatever order the list endpoint asked for is the order the database hands back, and the
    // route passes it through untouched rather than re-sorting on the client.
    selectRows = [
      { id: "c-2", title: "second", sortOrder: 0 },
      { id: "c-9", title: "tied", sortOrder: 1 },
      { id: "c-1", title: "tied", sortOrder: 1 },
      { id: "c-3", title: "last", sortOrder: 2 },
    ];

    const res = await GET(listRequest());

    expect((await res.json()).map((c: any) => c.id)).toEqual(["c-2", "c-9", "c-1", "c-3"]);
  });
});

describe("POST /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows = [];
    mockInserted = null;
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/conversations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-1" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("lands the new thread at the end of the user's list for that repository", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await POST(
      new Request("http://localhost/api/conversations", {
        method: "POST",
        body: JSON.stringify({ repositoryId: "repo-1" }),
      }),
    );

    expect(res.status).toBe(200);
    // `max(sort_order) + 1` is computed inside the insert itself, so two threads created at the
    // same moment cannot both read the same maximum and land on the same position.
    expect(String(mockInserted.sortOrder)).toContain("coalesce(max(conv_sortOrder), -1) + 1");
    expect(String(mockInserted.sortOrder)).toContain("conv_userId");
    expect(String(mockInserted.sortOrder)).toContain("user-1");
    expect(String(mockInserted.sortOrder)).toContain("repo-1");
  });
});