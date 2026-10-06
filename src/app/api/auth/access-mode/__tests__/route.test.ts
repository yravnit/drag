import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

const mockGetUserAccessMode = vi.fn();
vi.mock("@/lib/auth/accessMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/accessMode")>();
  return {
    ...actual,
    getUserAccessMode: (...args: any[]) => mockGetUserAccessMode(...args),
  };
});

vi.mock("@/db/db", () => ({
  db: {},
}));

describe("GET /api/auth/access-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/auth/access-mode");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 200 with public scopes when user access mode is public", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-public", name: "Alice" },
    });
    mockGetUserAccessMode.mockResolvedValueOnce("public");

    const request = new Request("http://localhost/api/auth/access-mode");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      accessMode: "public",
      scopes: ["public_repo", "read:user"],
    });
  });

  it("returns 200 with full scopes when user access mode is full", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-full", name: "Bob" },
    });
    mockGetUserAccessMode.mockResolvedValueOnce("full");

    const request = new Request("http://localhost/api/auth/access-mode");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({
      accessMode: "full",
      scopes: ["repo", "read:org"],
    });
  });

  it("returns 500 when access mode resolution throws", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-err", name: "Charlie" },
    });
    mockGetUserAccessMode.mockRejectedValueOnce(new Error("Database connection lost"));

    const request = new Request("http://localhost/api/auth/access-mode");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to determine access mode");
  });
});
