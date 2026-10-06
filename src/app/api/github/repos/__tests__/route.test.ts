import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

const mockGetSession = vi.fn();
const mockGetAccessToken = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
      getAccessToken: (...args: any[]) => mockGetAccessToken(...args),
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

const originalFetch = global.fetch;

describe("GET /api/github/repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/github/repos");
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 403 when GitHub credentials are missing", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-1", name: "User" },
    });
    mockGetAccessToken.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/github/repos");
    const response = await GET(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("No GitHub credentials found");
  });

  it("annotates private repos with requiresUpgrade=true in Public-only mode", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-pub", name: "Public User" },
    });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "gho_token_pub" });
    mockGetUserAccessMode.mockResolvedValueOnce("public");

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 101,
          name: "public-lib",
          owner: { login: "octocat" },
          full_name: "octocat/public-lib",
          html_url: "https://github.com/octocat/public-lib",
          description: "A public library",
          private: false,
          default_branch: "main",
          updated_at: "2026-09-01T00:00:00Z",
        },
        {
          id: 102,
          name: "secret-vault",
          owner: { login: "octocat" },
          full_name: "octocat/secret-vault",
          html_url: "https://github.com/octocat/secret-vault",
          description: "Internal repo",
          private: true,
          default_branch: "main",
          updated_at: "2026-09-02T00:00:00Z",
        },
      ],
    } as any);

    const request = new Request("http://localhost/api/github/repos");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Access-Mode")).toBe("public");
    const data = await response.json();
    expect(data).toHaveLength(2);
    expect(data[0].requiresUpgrade).toBe(false);
    expect(data[1].requiresUpgrade).toBe(true);
  });

  it("annotates private repos with requiresUpgrade=false in Full access mode", async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: "user-full", name: "Full User" },
    });
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "gho_token_full" });
    mockGetUserAccessMode.mockResolvedValueOnce("full");

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 102,
          name: "secret-vault",
          owner: { login: "octocat" },
          full_name: "octocat/secret-vault",
          html_url: "https://github.com/octocat/secret-vault",
          description: "Internal repo",
          private: true,
          default_branch: "main",
          updated_at: "2026-09-02T00:00:00Z",
        },
      ],
    } as any);

    const request = new Request("http://localhost/api/github/repos");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Access-Mode")).toBe("full");
    const data = await response.json();
    expect(data[0].requiresUpgrade).toBe(false);
  });
});
