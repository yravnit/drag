import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { start } from "workflow/api";
import { auth } from "@/lib/auth/server";

const mockGetRepository = vi.fn();
const mockGetTree = vi.fn();
vi.mock("@/lib/ingestion/githubApiClient", () => {
  return {
    GitHubApiClient: class {
      getRepository = mockGetRepository;
      getTree = mockGetTree;
    },
  };
});

const mockCheckRateLimit = vi.fn().mockResolvedValue({
  allowed: true,
  remaining: 10,
  resetAt: Date.now() + 60000,
});
vi.mock("@/lib/rateLimit/rateLimiter", () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

/** drizzle-like select chain where() is awaitable and also exposes limit()/for() */
let selectRows: any[] = [];
function selectChain() {
  const rows = selectRows;
  return {
    from: () => ({
      where: () =>
        Object.assign(Promise.resolve(rows), {
          limit: async () => rows,
          for: async () => rows,
        }),
    }),
  };
}

const mockDbTransaction = vi.fn();
const mockDbInsertValues = vi.fn();
vi.mock("@/db/db", () => ({
  db: {
    select: () => selectChain(),
    insert: () => ({
      values: (...args: any[]) => {
        mockDbInsertValues(...args);
        return {
          onConflictDoUpdate: async () => undefined,
          returning: async () => [{ id: "new-repo-id" }],
        };
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: (...args: any[]) => mockDbTransaction(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  // The association insert derives its sort_order from a subquery in the same statement.
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), ""),
    { raw: (strings: TemplateStringsArray) => strings.join("?") },
  ),
}));

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/workflows/ingest", () => ({
  ingestRepository: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      getAccessToken: vi.fn(),
    },
  },
}));

const mockGetUserAccessMode = vi.fn().mockResolvedValue("public");
vi.mock("@/lib/auth/accessMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/accessMode")>();
  return {
    ...actual,
    getUserAccessMode: (...args: any[]) => mockGetUserAccessMode(...args),
  };
});

const mockGetUserEntitlements = vi.fn();
vi.mock("@/lib/plans/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plans/entitlements")>();
  return {
    ...actual,
    getUserEntitlements: (...args: any[]) => mockGetUserEntitlements(...args),
  };
});
function setupRateLimitAllowed() {
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 10,
    resetAt: Date.now() + 60000,
  });
}

describe("POST /api/workflows/ingest-repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows = [];
    mockGetUserEntitlements.mockResolvedValue({
      plan: "free",
      repositoryLimit: 2,
      monthlyQueryLimit: 25,
      repositorySizeLimitBytes: 50 * 1024 * 1024,
      fileLimit: 2500,
      allowedBranch: "main",
      incrementalReindexAllowed: false,
    });
    mockGetTree.mockResolvedValue({ tree: [], truncated: false });
    mockDbTransaction.mockImplementation(async (cb: any) =>
      cb({
        select: () => selectChain(),
        insert: () => ({
          values: (...args: any[]) => {
            mockDbInsertValues(...args);
            return {
              onConflictDoUpdate: async () => undefined,
              returning: async () => [{ id: "new-repo-id" }],
            };
          },
        }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    );
  });

  it("returns 400 for malformed JSON body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "malformed text",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Malformed JSON body");
  });

  it("returns 400 for null, array, or non-object bodies", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify([1, 2, 3]),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("non-null object");
  });

  it("returns 400 if owner or repo is missing or invalid format", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Required field "repo"');
  });

  it("returns 401 if user is not authenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 403 if user has no access token", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce(null as any);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("GitHub OAuth credentials");
  });

  it("returns 403 if user does not have access to the repository", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockRejectedValueOnce(new Error("Not Found"));

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("Denied access to repository");
  });

  it("starts workflow and returns 200 for valid authorized requests", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "valid-repo",
      owner: { login: "valid-owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
    });
    vi.mocked(start).mockResolvedValueOnce({ runId: "run-abc-123" } as any);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        owner: "valid-owner",
        repo: "valid-repo",
        revision: "main",
        batchSize: 20,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Ingestion workflow started");
    expect(data.runId).toBe("run-abc-123");
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      {
        owner: "valid-owner",
        repo: "valid-repo",
        revision: "main",
        batchSize: 20,
        authToken: "github-token",
        userId: "user-1",
      },
    ]);
  });

  it("returns 400 when user requests a non-main branch on Free plan", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "valid-repo",
      owner: { login: "valid-owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
    });

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo", revision: "dev" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Only the 'main' branch is supported");
  });

  it("returns 409 when a shared repository is already indexed on a different branch", async () => {
    // repositories rows are keyed by githubId and shared across users, so re-ingesting one on a
    // different branch would replace the chunks every other associated user reads from.
    setupRateLimitAllowed();
    mockGetUserEntitlements.mockResolvedValue({
      plan: "hobby",
      repositoryLimit: 10,
      monthlyQueryLimit: 250,
      repositorySizeLimitBytes: 250 * 1024 * 1024,
      fileLimit: 12500,
      allowedBranch: "*",
      incrementalReindexAllowed: true,
    });
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "valid-repo",
      owner: { login: "valid-owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
      private: false,
    });
    selectRows = [{ id: "shared-repo-id", defaultBranch: "main" }];

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo", revision: "dev" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain("already indexed on branch 'main'");
    expect(start).not.toHaveBeenCalled();
  });

  it("allows re-ingest on the same branch the shared repository is already indexed on", async () => {
    setupRateLimitAllowed();
    mockGetUserEntitlements.mockResolvedValue({
      plan: "hobby",
      repositoryLimit: 10,
      monthlyQueryLimit: 250,
      repositorySizeLimitBytes: 250 * 1024 * 1024,
      fileLimit: 12500,
      allowedBranch: "*",
      incrementalReindexAllowed: true,
    });
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "valid-repo",
      owner: { login: "valid-owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
      private: false,
    });
    selectRows = [{ id: "shared-repo-id", defaultBranch: "main" }];
    vi.mocked(start).mockResolvedValueOnce({ runId: "run-abc-123" } as any);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo", revision: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalled();
  });

  it("returns 403 when user in Public-only access mode attempts to ingest a private repository", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-public", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "secret-repo",
      owner: { login: "valid-owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
      private: true,
    });
    mockGetUserAccessMode.mockResolvedValueOnce("public");

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "secret-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain(
      "Private repositories are not permitted in Public-only access mode",
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("allows ingesting a private repository when user has Full repository access mode", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-full", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "secret-repo",
      owner: { login: "valid-owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
      private: true,
    });
    mockGetUserAccessMode.mockResolvedValueOnce("full");
    vi.mocked(start).mockResolvedValueOnce({ runId: "run-full-123" } as any);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "secret-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Ingestion workflow started");
    expect(data.runId).toBe("run-full-123");
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({
        owner: "valid-owner",
        repo: "secret-repo",
        authToken: "github-token",
      }),
    ]);
  });

  it("assigns the resolved branch to the payload when revision is omitted", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "valid-repo",
      owner: { login: "valid-owner" },
      html_url: "https://github.com/valid-owner/valid-repo",
      default_branch: "develop",
      description: null,
      language: null,
    });
    vi.mocked(start).mockResolvedValueOnce({ runId: "run-abc" } as any);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "valid-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    // Free plan resolves to main and the payload must carry it, otherwise the workflow
    // would acquire the repository's GitHub default branch (develop) and bypass the policy.
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({ revision: "main" }),
    ]);
    expect(mockGetTree).toHaveBeenCalledWith("valid-owner", "valid-repo", "main", true);
  });

  it("returns 400 when the repository exceeds the plan file limit", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "big-repo",
      owner: { login: "valid-owner" },
      html_url: "https://github.com/valid-owner/big-repo",
      default_branch: "main",
      private: false,
    });
    mockGetTree.mockResolvedValueOnce({
      tree: Array.from({ length: 2600 }, () => ({ type: "blob", size: 1 })),
      truncated: false,
    });

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "big-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("exceeding the limit of 2,500 files");
    expect(start).not.toHaveBeenCalled();
  });

  it("returns 400 when the repository exceeds the plan size limit", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      name: "fat-repo",
      owner: { login: "valid-owner" },
      html_url: "https://github.com/valid-owner/fat-repo",
      default_branch: "main",
      private: false,
    });
    mockGetTree.mockResolvedValueOnce({
      tree: [{ type: "blob", size: 60 * 1024 * 1024 }],
      truncated: false,
    });

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "fat-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("exceeds the limit of 50 MB");
    expect(start).not.toHaveBeenCalled();
  });

  it("creates the user_repositories association so ingested repositories count toward the limit", async () => {
    setupRateLimitAllowed();
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      session: { id: "session-1" },
      user: { id: "user-1", name: "User" },
    } as any);
    vi.mocked(auth.api.getAccessToken).mockResolvedValueOnce({
      accessToken: "github-token",
    } as any);
    mockGetRepository.mockResolvedValueOnce({
      id: 555,
      name: "counted-repo",
      owner: { login: "valid-owner" },
      html_url: "https://github.com/valid-owner/counted-repo",
      default_branch: "main",
      private: false,
    });
    vi.mocked(start).mockResolvedValueOnce({ runId: "run-counted" } as any);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ owner: "valid-owner", repo: "counted-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const associationInsert = mockDbInsertValues.mock.calls.find(
      ([values]: any[]) => values && values.userId === "user-1" && values.repositoryId,
    );
    expect(associationInsert).toBeDefined();
  });
});
