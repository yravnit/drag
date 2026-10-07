import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { embedRepository } from "@/workflows/embed";

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

const mockGetUserAccessMode = vi.fn().mockResolvedValue("public");
vi.mock("@/lib/auth/accessMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/accessMode")>();
  return {
    ...actual,
    getUserAccessMode: (...args: any[]) => mockGetUserAccessMode(...args),
  };
});

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    insert: (...args: any[]) => mockDbInsert(...args),
    update: (...args: any[]) => mockDbUpdate(...args),
    transaction: vi.fn(async (cb: any) =>
      cb({
        select: (...args: any[]) => mockDbSelect(...args),
        insert: (...args: any[]) => mockDbInsert(...args),
        update: (...args: any[]) => mockDbUpdate(...args),
      }),
    ),
  },
}));

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
vi.mock("@/lib/rateLimit/rateLimiter", () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/db/schema", () => ({
  repositories: {
    id: "repositories_id",
    githubId: "repositories_githubId",
    name: "repositories_name",
    owner: "repositories_owner",
    url: "repositories_url",
    defaultBranch: "repositories_defaultBranch",
    description: "repositories_description",
    primaryLanguage: "repositories_primaryLanguage",
    indexedAt: "repositories_indexedAt",
    embeddingStatus: "repositories_embeddingStatus",
    embeddingLeaseExpiresAt: "repositories_embeddingLeaseExpiresAt",
    createdAt: "repositories_createdAt",
    updatedAt: "repositories_updatedAt",
  },
  userRepositories: {
    userId: "userRepositories_userId",
    repositoryId: "userRepositories_repositoryId",
  },
  chunks: {
    id: "chunks_id",
    repositoryId: "chunks_repositoryId",
    embedding: "chunks_embedding",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
}));

let mockExistingRepo: any = null;
let mockUserRepos: any[] = [];
let mockUserRecord: any = null;
/** Whether the user already has a user_repositories row for the repository being added. */
let mockAssociationExists = false;
/** Whether the existing repository has chunks still awaiting an embedding. */
let mockPendingChunks = false;

function createSelectChain() {
  return {
    from: vi.fn().mockImplementation((table: any) => {
      // Matches both the mocked "@/db/schema" stubs and the real drizzle tables that
      // entitlements.ts imports directly.
      const isRepositories =
        table?.githubId === "repositories_githubId" || typeof table?.githubId === "bigint" || table?.githubId instanceof BigInt || table === "repositories";
      const isUser = table === "user" || Boolean(table?.plan) || table?.id === "user_id";
      const isChunks = table?.embedding === "chunks_embedding" || table === "chunks";

      const getResult = () => {
        if (isChunks) return mockPendingChunks ? [{ id: "chunk-pending" }] : [];
        if (isRepositories) return mockExistingRepo ? [mockExistingRepo] : [];
        if (isUser) return mockUserRecord ? [mockUserRecord] : [];
        // user_repositories: the plan-limit count
        return mockUserRepos;
      };

      // .limit(1) is an existence probe; the bare await is the count. Model them separately.
      const getLimitedResult = () => {
        if (isChunks) return getResult();
        if (isRepositories || isUser) return getResult();
        return mockAssociationExists ? [{ repositoryId: "existing" }] : [];
      };

      const whereFn = vi.fn().mockImplementation(() => {
        return Object.assign(Promise.resolve(getResult()), {
          limit: vi.fn().mockImplementation(() => Promise.resolve(getLimitedResult())),
          for: vi.fn().mockImplementation(() => Promise.resolve(getResult())),
        });
      });

      const chainObj: any = {
        where: whereFn,
        limit: vi.fn().mockImplementation(() => Promise.resolve(getLimitedResult())),
        for: vi.fn().mockImplementation(() => Promise.resolve(getResult())),
        innerJoin: vi.fn().mockImplementation(() => chainObj),
      };
      return chainObj;
    }),
  };
}

const mockGetRepository = vi.fn();
const mockGetTree = vi.fn();
const mockGetCommit = vi.fn();
vi.mock("@/lib/ingestion/githubApiClient", () => {
  return {
    GitHubApiClient: class {
      getRepository = mockGetRepository;
      getTree = mockGetTree;
      getCommit = mockGetCommit;
    },
  };
});

const mockWorkflowStart = vi.fn();
vi.mock("workflow/api", () => ({
  start: (...args: any[]) => mockWorkflowStart(...args),
}));

vi.mock("@/workflows/ingest", () => ({
  ingestRepository: vi.fn(),
}));

vi.mock("@/workflows/embed", () => ({
  embedRepository: vi.fn(),
}));

describe("POST /api/repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingRepo = null;
    mockUserRepos = [];
    mockUserRecord = null;
    mockAssociationExists = false;
    mockPendingChunks = false;
    // `mockClear` (inside clearAllMocks) keeps queued `mockResolvedValueOnce` values, so a test
    // that returns early would leak its GitHub responses into the next one.
    mockGetRepository.mockReset();
    mockGetCommit.mockReset();
    mockGetTree.mockReset();
    mockDbSelect.mockImplementation(createSelectChain);
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "new-repo-id" }]),
      }),
    });
  });

  it("returns 401 if user is not authenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 if repository URL is missing", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 if URL format is invalid", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "not-a-github-url" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-rate-limited" } } as any);
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(429);
  });

  it("returns 400 if repository size check fails (too many files)", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "repo",
      owner: { login: "owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "commit-sha-123" });

    // Mock getTree to return a very large repo (e.g. 6000 blobs)
    const largeTree = Array.from({ length: 5001 }, () => ({ type: "blob", size: 100 }));
    mockGetTree.mockResolvedValueOnce({ tree: largeTree, truncated: false });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("too many files");
  });

  it("returns 400 if GitHub tree response is marked as truncated", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "huge-repo",
      owner: { login: "owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "commit-sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [], truncated: true });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/huge-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("truncated by GitHub");
  });

  it("resolves main branch to commit SHA and passes it to getTree", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "valid-repo",
      owner: { login: "owner" },
      html_url: "url",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "resolved-sha-999" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 50 }], truncated: false });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/valid-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockGetCommit).toHaveBeenCalledWith("owner", "valid-repo", "main");
    expect(mockGetTree).toHaveBeenCalledWith("owner", "valid-repo", "resolved-sha-999", true);
    expect(mockWorkflowStart).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ revision: "resolved-sha-999" })],
    );
  });

  it("returns 400 if repository does not have required main branch", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "non-main-repo",
      owner: { login: "owner" },
      html_url: "url",
      default_branch: "develop",
      description: null,
      language: null,
    });
    mockGetCommit.mockRejectedValueOnce(new Error("Branch not found"));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/non-main-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Only the 'main' branch is supported");
  });

  it("retries ingestion when existing repository is in failed state", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "failed-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/failed-repo",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [], truncated: false });

    mockExistingRepo = {
      id: "existing-failed-id",
      embeddingStatus: "failed",
      name: "failed-repo",
      owner: "owner",
      url: "https://github.com/owner/failed-repo",
    };

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/failed-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockWorkflowStart).toHaveBeenCalled();
  });

  it("saves verified visibility when a repository flips to private without being renamed", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    // Private repositories need Full access mode, otherwise the route 403s before saving.
    mockGetUserAccessMode.mockResolvedValueOnce("full");
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "flipped-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/flipped-repo",
      default_branch: "main",
      // GitHub now reports it private; the stored row still says public.
      private: true,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 10 }], truncated: false });

    mockExistingRepo = {
      id: "flipped-id",
      embeddingStatus: "ready",
      name: "flipped-repo",
      owner: "owner",
      url: "https://github.com/owner/flipped-repo",
      defaultBranch: "main",
      isPrivate: false,
    };

    let saved: any = null;
    mockDbUpdate.mockImplementation(() => ({
      set: (values: any) => {
        saved = values;
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/flipped-repo" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    // Without this write, runEmbedBatch reads isPrivate = false and sends private source to Gemini.
    expect(saved).not.toBeNull();
    expect(saved.isPrivate).toBe(true);
  });

  it("retries embeddings directly when chunks are already indexed", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "embed-failed",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/embed-failed",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 10 }], truncated: false });
    mockExistingRepo = {
      id: "embed-failed-id",
      embeddingStatus: "failed",
      name: "embed-failed",
      owner: "owner",
      url: "https://github.com/owner/embed-failed",
      defaultBranch: "main",
    };
    // Chunks exist but have no embedding: ingestion already finished.
    mockPendingChunks = true;

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/embed-failed" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    // Restarting ingestion would be rejected for Free users with tracked files, and unchanged
    // files return `skipped` without triggering embedding, so recovery must go straight to embed.
    expect(mockWorkflowStart).toHaveBeenCalledWith(embedRepository, [
      { repositoryId: "embed-failed-id" },
    ]);
  });

  it("falls back to the URL when a legacy row has no github_id and backfills it", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 777,
      name: "legacy-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/legacy-repo",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 10 }], truncated: false });

    // Legacy row: github_id is null, so the github-id lookup misses it and the route falls back
    // to the URL lookup.
    const legacy = {
      id: "legacy-id",
      githubId: null,
      embeddingStatus: "ready",
      name: "legacy-repo",
      owner: "owner",
      url: "https://github.com/owner/legacy-repo",
      defaultBranch: "main",
    };

    let repositoryLookups = 0;
    mockDbSelect.mockImplementation(() => {
      const chain = createSelectChain();
      const originalFrom = chain.from;
      chain.from = vi.fn().mockImplementation((table: any) => {
        const result = originalFrom(table);
        const isRepositories =
          table?.githubId === "repositories_githubId" || table === "repositories";
        if (!isRepositories) return result;
        // First repositories select is the github-id lookup, second is the URL fallback.
        repositoryLookups++;
        const row = repositoryLookups === 1 ? [] : [legacy];
        return {
          ...result,
          where: vi.fn().mockReturnValue(
            Object.assign(Promise.resolve(row), {
              limit: vi.fn().mockResolvedValue(row),
              for: vi.fn().mockResolvedValue(row),
            }),
          ),
        };
      });
      return chain;
    });

    let backfilled: any = null;
    mockDbUpdate.mockImplementation(() => ({
      set: (values: any) => {
        backfilled = values;
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/legacy-repo" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    // Reuses the existing row rather than inserting a duplicate that fails on the unique URL.
    expect(data.repositoryId).toBe("legacy-id");
    expect(data.alreadyExists).toBe(true);
    expect(backfilled?.githubId).toBe(BigInt(777));
  });

  it("does not start duplicate ingestion when existing repository is already ready", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "ready-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/ready-repo",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [], truncated: false });

    mockExistingRepo = {
      id: "existing-ready-id",
      embeddingStatus: "ready",
      name: "ready-repo",
      owner: "owner",
      url: "https://github.com/owner/ready-repo",
    };

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/ready-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("returns 403 when user in Public-only access mode attempts to add a private repository", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-public" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 99999,
      name: "private-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/private-repo",
      default_branch: "main",
      description: null,
      language: null,
      private: true,
    });
    mockGetUserAccessMode.mockResolvedValueOnce("public");

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/private-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("Private repositories are not permitted in Public-only access mode");
    expect(mockGetCommit).not.toHaveBeenCalled();
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("allows adding a private repository when user has Full repository access mode", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-full" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-full" });
    mockGetRepository.mockResolvedValueOnce({
      id: 99999,
      name: "private-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/private-repo",
      default_branch: "main",
      description: null,
      language: null,
      private: true,
    });
    mockGetUserAccessMode.mockResolvedValueOnce("full");
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-private" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 50 }], truncated: false });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/private-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockGetCommit).toHaveBeenCalledWith("owner", "private-repo", "main");
    expect(mockWorkflowStart).toHaveBeenCalled();
  });

  it("Free plan: rejects client requesting non-main branch with 400", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockUserRecord = { id: "user-1", plan: "free" };
    mockGetRepository.mockResolvedValueOnce({
      id: 1234,
      name: "repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/repo",
      default_branch: "main",
      private: false,
    });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/repo", branch: "develop" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Only the 'main' branch is supported on your plan");
  });

  it("Enterprise plan: allows selecting branch configured in entitlement and persists the branch", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-enterprise" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-enterprise" });
    mockUserRecord = {
      id: "user-enterprise",
      plan: "enterprise",
      customAllowedBranch: "staging",
    };

    mockGetRepository.mockResolvedValueOnce({
      id: 8888,
      name: "enterprise-repo",
      owner: { login: "corp" },
      html_url: "https://github.com/corp/enterprise-repo",
      default_branch: "main",
      description: "Corp repo",
      language: "TypeScript",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-staging-commit-456" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 100 }], truncated: false });

    let capturedInsertValues: any = null;
    mockDbInsert.mockImplementation(() => ({
      values: vi.fn().mockImplementation((val) => {
        if (val && typeof val === "object" && "defaultBranch" in val) {
          capturedInsertValues = val;
        }
        return {
          returning: vi.fn().mockResolvedValue([{ id: "enterprise-repo-id" }]),
        };
      }),
    }));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({
        url: "https://github.com/corp/enterprise-repo",
        branch: "staging",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockGetCommit).toHaveBeenCalledWith("corp", "enterprise-repo", "staging");
    expect(mockGetTree).toHaveBeenCalledWith("corp", "enterprise-repo", "sha-staging-commit-456", true);
    expect(mockWorkflowStart).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ revision: "sha-staging-commit-456" })],
    );
    expect(capturedInsertValues).toMatchObject({ defaultBranch: "staging" });
    // headCommitSha is deliberately absent: the ingestion pipeline records it after a
    // successful ingest. Writing it here would trip the workflow's unchanged-SHA skip.
    expect(capturedInsertValues).not.toHaveProperty("headCommitSha");
  });

  it("Enterprise plan: rejects branch when not permitted by configured entitlement", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-enterprise" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-enterprise" });
    mockUserRecord = {
      id: "user-enterprise",
      plan: "enterprise",
      customAllowedBranch: "staging",
    };
    mockGetRepository.mockResolvedValueOnce({
      id: 8888,
      name: "enterprise-repo",
      owner: { login: "corp" },
      html_url: "https://github.com/corp/enterprise-repo",
      default_branch: "main",
      private: false,
    });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({
        url: "https://github.com/corp/enterprise-repo",
        branch: "prod",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Only the 'staging' branch is supported on your plan");
  });

  it("Enterprise plan: retains safe default main when no custom branch is configured", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-ent-default" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-ent" });
    mockUserRecord = {
      id: "user-ent-default",
      plan: "enterprise",
      customAllowedBranch: null, // No custom branch configured
    };

    mockGetRepository.mockResolvedValueOnce({
      id: 9999,
      name: "safe-default-repo",
      owner: { login: "corp" },
      html_url: "https://github.com/corp/safe-default-repo",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-main-safe" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 50 }], truncated: false });

    let capturedInsert: any = null;
    mockDbInsert.mockImplementation(() => ({
      values: vi.fn().mockImplementation((val) => {
        if (val && typeof val === "object" && "defaultBranch" in val) {
          capturedInsert = val;
        }
        return {
          returning: vi.fn().mockResolvedValue([{ id: "safe-id" }]),
        };
      }),
    }));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/corp/safe-default-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockGetCommit).toHaveBeenCalledWith("corp", "safe-default-repo", "main");
    expect(capturedInsert).toMatchObject({ defaultBranch: "main" });
    expect(capturedInsert).not.toHaveProperty("headCommitSha");
  });

  it("Enterprise plan: allows any branch when wildcard * is configured", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-wildcard" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-wildcard" });
    mockUserRecord = {
      id: "user-wildcard",
      plan: "enterprise",
      customAllowedBranch: "*",
    };

    mockGetRepository.mockResolvedValueOnce({
      id: 7777,
      name: "wildcard-repo",
      owner: { login: "corp" },
      html_url: "https://github.com/corp/wildcard-repo",
      default_branch: "main",
      description: null,
      language: null,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-feature-custom" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 50 }], truncated: false });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({
        url: "https://github.com/corp/wildcard-repo",
        branch: "feature/experimental-branch",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockGetCommit).toHaveBeenCalledWith("corp", "wildcard-repo", "feature/experimental-branch");
  });

  it("never trusts client-supplied plan or authorization parameters in request body", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-sneaky" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-sneaky" });
    mockUserRecord = {
      id: "user-sneaky",
      plan: "free", // Server record says free!
    };
    mockGetRepository.mockResolvedValueOnce({
      id: 5555,
      name: "repo",
      owner: { login: "corp" },
      html_url: "https://github.com/corp/repo",
      default_branch: "main",
      private: false,
    });

    // Client attempts to spoof an enterprise plan with custom branch
    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({
        url: "https://github.com/corp/repo",
        branch: "release-v2",
        plan: "enterprise", // Client forgery
        authorization: "enterprise-admin",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Only the 'main' branch is supported on your plan");
  });

  it("allows re-adding an already associated repository even when the user is at the limit", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-free" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockUserRecord = { id: "user-free", plan: "free" };
    // Free plan limit is 2 and this user already owns both
    mockUserRepos = [{ repositoryId: "existing-ready-id" }, { repositoryId: "repo-2" }];
    mockAssociationExists = true;
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "ready-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/ready-repo",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [], truncated: false });
    mockExistingRepo = {
      id: "existing-ready-id",
      defaultBranch: "main",
      embeddingStatus: "ready",
      name: "ready-repo",
      owner: "owner",
      url: "https://github.com/owner/ready-repo",
    };

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/ready-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("returns 409 when a repository already indexed on another branch is requested on a different branch", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-ent" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-ent" });
    mockUserRecord = { id: "user-ent", plan: "enterprise", customAllowedBranch: "*" };
    mockGetRepository.mockResolvedValueOnce({
      id: 8888,
      name: "shared-repo",
      owner: { login: "corp" },
      html_url: "https://github.com/corp/shared-repo",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-staging" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 10 }], truncated: false });
    mockExistingRepo = {
      id: "shared-repo-id",
      defaultBranch: "staging",
      embeddingStatus: "ready",
      name: "shared-repo",
      owner: "corp",
      url: "https://github.com/corp/shared-repo",
    };

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/corp/shared-repo", branch: "main" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain("already indexed on branch 'staging'");
    // Must not overwrite the shared branch or start a second ingestion
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });

  it("never writes headCommitSha before ingestion so the workflow does not skip the repository", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "failed-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/failed-repo",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "fresh-sha" });
    mockGetTree.mockResolvedValueOnce({ tree: [], truncated: false });
    mockExistingRepo = {
      id: "existing-failed-id",
      defaultBranch: "main",
      embeddingStatus: "failed",
      name: "failed-repo",
      owner: "owner",
      url: "https://github.com/owner/failed-repo",
    };

    let recoveryUpdate: any = null;
    mockDbUpdate.mockImplementation(() => ({
      set: (values: any) => {
        recoveryUpdate = values;
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/failed-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(recoveryUpdate).not.toBeNull();
    expect(recoveryUpdate).not.toHaveProperty("headCommitSha");
    expect(mockWorkflowStart).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ revision: "fresh-sha" })],
    );
  });

  it("creates the user_repositories association inside the limit-check transaction", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "assoc-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/assoc-repo",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 10 }], truncated: false });

    let associationValues: any = null;
    mockDbInsert.mockImplementation(() => ({
      values: (values: any) => {
        if (values && values.userId && values.repositoryId) associationValues = values;
        return { returning: vi.fn().mockResolvedValue([{ id: "new-repo-id" }]) };
      },
    }));

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/assoc-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(associationValues).toEqual({ userId: "user-1", repositoryId: "new-repo-id" });
    expect(mockWorkflowStart).toHaveBeenCalled();
  });

  it("returns 403 and does not start ingestion when the plan repository limit is reached", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-free" } } as any);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: "token-123" });
    mockUserRecord = { id: "user-free", plan: "free" };
    mockUserRepos = [{ repositoryId: "repo-1" }, { repositoryId: "repo-2" }];
    mockGetRepository.mockResolvedValueOnce({
      id: 12345,
      name: "third-repo",
      owner: { login: "owner" },
      html_url: "https://github.com/owner/third-repo",
      default_branch: "main",
      private: false,
    });
    mockGetCommit.mockResolvedValueOnce({ sha: "sha-123" });
    mockGetTree.mockResolvedValueOnce({ tree: [{ type: "blob", size: 10 }], truncated: false });

    const request = new Request("http://localhost/api/repos", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/owner/third-repo" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("Repository limit reached for your plan (2/2");
    expect(mockWorkflowStart).not.toHaveBeenCalled();
  });
});
