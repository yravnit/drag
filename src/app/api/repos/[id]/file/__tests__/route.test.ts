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

const mockAssertAssociation = vi.fn();
const mockVerifyAccess = vi.fn();
vi.mock("@/lib/access/repositoryAccess", () => ({
  assertRepositoryAssociation: (...args: any[]) => mockAssertAssociation(...args),
  verifyRepositoryAccess: (...args: any[]) => mockVerifyAccess(...args),
}));

const mockSelect = vi.fn();
vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
  },
}));

describe("GET /api/repos/[id]/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/repos/repo-1/file?path=src/index.ts");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(401);
  });

  it("returns 403 if user is not associated with the repository", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(false);

    const request = new Request("http://localhost/api/repos/repo-1/file?path=src/index.ts");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(403);
  });

  it("returns 404 if repository does not exist", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([]),
        }),
      }),
    });

    const request = new Request("http://localhost/api/repos/repo-1/file?path=src/index.ts");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(404);
  });

  it("returns 403 if user does not have access on GitHub", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: "repo-1",
              owner: "owner",
              name: "repo",
              defaultBranch: "main",
              headCommitSha: "abc",
              isPrivate: true,
            },
          ]),
        }),
      }),
    });

    mockVerifyAccess.mockResolvedValueOnce({ hasAccess: false });

    const request = new Request("http://localhost/api/repos/repo-1/file?path=src/index.ts");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(403);
  });

  it("returns 400 if path parameter is missing", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: "repo-1",
              owner: "owner",
              name: "repo",
              defaultBranch: "main",
              headCommitSha: "abc",
              isPrivate: false,
            },
          ]),
        }),
      }),
    });

    mockVerifyAccess.mockResolvedValueOnce({ hasAccess: true });

    const request = new Request("http://localhost/api/repos/repo-1/file");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(400);
  });

  it("returns 400 if path contains directory traversal", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: "repo-1",
              owner: "owner",
              name: "repo",
              defaultBranch: "main",
              headCommitSha: "abc",
              isPrivate: false,
            },
          ]),
        }),
      }),
    });

    mockVerifyAccess.mockResolvedValueOnce({ hasAccess: true });

    const request = new Request("http://localhost/api/repos/repo-1/file?path=../../etc/passwd");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(400);
  });

  it("returns 403 if path targets sensitive/secret files", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: "repo-1",
              owner: "owner",
              name: "repo",
              defaultBranch: "main",
              headCommitSha: "abc",
              isPrivate: false,
            },
          ]),
        }),
      }),
    });

    mockVerifyAccess.mockResolvedValueOnce({ hasAccess: true });

    const request = new Request("http://localhost/api/repos/repo-1/file?path=.env.production");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(403);
  });

  it("returns file content successfully from database chunks fallback", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: "repo-1",
              owner: "owner",
              name: "repo",
              defaultBranch: "main",
              headCommitSha: "abc",
              isPrivate: false,
            },
          ]),
        }),
      }),
    });

    mockVerifyAccess.mockResolvedValueOnce({ hasAccess: true });
    mockGetAccessToken.mockResolvedValueOnce(null);

    // Chunks query fallback
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          orderBy: vi.fn().mockResolvedValueOnce([
            { text: "const a = 1;", startLine: 1 },
            { text: "const b = 2;", startLine: 5 },
          ]),
        }),
      }),
    });

    // Mock fetch to simulate GitHub failing or not returning
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    try {
      const request = new Request("http://localhost/api/repos/repo-1/file?path=src/index.ts");
      const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toContain("index.ts");
      // Private repository source must never be written to the browser disk cache
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const content = await response.text();
      expect(content).toContain("const a = 1;");
      expect(content).toContain("const b = 2;");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
