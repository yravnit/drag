import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks
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

const mockStart = vi.fn().mockResolvedValue({ runId: "run-test-123" });
vi.mock("workflow/api", () => ({
  start: (...args: any[]) => mockStart(...args),
}));

const mockAssertRepositoryAssociation = vi.fn();
vi.mock("@/lib/access/repositoryAccess", () => ({
  assertRepositoryAssociation: (...args: any[]) => mockAssertRepositoryAssociation(...args),
}));

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 60000 });
vi.mock("@/lib/rateLimit/rateLimiter", () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/lib/ingestion/githubApiClient", () => ({
  GitHubApiClient: class {
    getRepository = vi.fn().mockResolvedValue({ id: 123, name: "drag", owner: { login: "octocat" } });
    getTree = vi.fn().mockResolvedValue({ tree: [], truncated: false });
  },
}));

vi.mock("@/db/db", () => {
  // drizzle-like chain: where() is awaitable and also exposes limit()/for()
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(
      () =>
        Object.assign(Promise.resolve([]), {
          limit: vi.fn().mockResolvedValue([]),
          for: vi.fn().mockResolvedValue([]),
        }),
    ),
    limit: vi.fn().mockResolvedValue([]),
    for: vi.fn().mockResolvedValue([]),
  };
  const insert = () => ({
    values: () => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      returning: vi.fn().mockResolvedValue([{ id: "workflow-repo-id" }]),
    }),
  });
  return {
    db: {
      select: vi.fn().mockImplementation(() => chain),
      insert: vi.fn().mockImplementation(insert),
      transaction: vi.fn().mockImplementation(async (cb: any) =>
        cb({
          select: vi.fn().mockImplementation(() => chain),
          insert: vi.fn().mockImplementation(insert),
        }),
      ),
    },
  };
});

import { POST as embedRoute } from "../embed/route";
import { POST as syncRoute } from "../sync/route";
import { POST as ingestRoute } from "../ingest-repository/route";

describe("Workflow endpoints security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "super-secret-token";
  });

  describe("POST /api/workflows/embed", () => {
    it("rejects unauthenticated requests with 401", async () => {
      mockGetSession.mockResolvedValue(null);

      const req = new Request("http://localhost/api/workflows/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: "repo-1" }),
      });

      const res = await embedRoute(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("rejects unauthorized users with 403 when they lack repository association", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockAssertRepositoryAssociation.mockResolvedValue(false);

      const req = new Request("http://localhost/api/workflows/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: "repo-2" }),
      });

      const res = await embedRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Forbidden");
    });

    it("accepts authorized users who have repository association", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
      mockAssertRepositoryAssociation.mockResolvedValue(true);

      const req = new Request("http://localhost/api/workflows/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: "repo-1" }),
      });

      const res = await embedRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.runId).toBe("run-test-123");
    });

    it("accepts internal requests authorized via cron bearer token", async () => {
      const req = new Request("http://localhost/api/workflows/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secret-token",
        },
        body: JSON.stringify({ repositoryId: "repo-internal" }),
      });

      const res = await embedRoute(req);
      expect(res.status).toBe(200);
      expect(mockStart).toHaveBeenCalled();
    });
  });

  describe("POST /api/workflows/sync", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const req = new Request("http://localhost/api/workflows/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 5 }),
      });

      const res = await syncRoute(req);
      expect(res.status).toBe(401);
    });

    it("accepts requests with valid cron secret", async () => {
      const req = new Request("http://localhost/api/workflows/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer super-secret-token",
        },
        body: JSON.stringify({ batchSize: 5 }),
      });

      const res = await syncRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.runId).toBe("run-test-123");
    });
  });

  describe("POST /api/workflows/ingest-repository", () => {
    it("rejects requests containing client-supplied authToken with 400", async () => {
      const req = new Request("http://localhost/api/workflows/ingest-repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: "octocat",
          repo: "drag",
          authToken: "ghp_untrustedClientToken",
        }),
      });

      const res = await ingestRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Client-supplied \"authToken\" is forbidden");
    });

    it("rejects unauthenticated callers with 401", async () => {
      mockGetSession.mockResolvedValue(null);

      const req = new Request("http://localhost/api/workflows/ingest-repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "octocat", repo: "drag" }),
      });

      const res = await ingestRoute(req);
      expect(res.status).toBe(401);
    });

    it("rejects when user is rate-limited with 429", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-rate-limited" } });
      mockCheckRateLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 300000,
      });

      const req = new Request("http://localhost/api/workflows/ingest-repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "octocat", repo: "drag" }),
      });

      const res = await ingestRoute(req);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
    });

    it("derives GitHub token from authenticated session and starts workflow", async () => {
      mockGetSession.mockResolvedValue({ user: { id: "user-ok" } });
      mockGetAccessToken.mockResolvedValue({ accessToken: "gho_validServerSessionToken" });

      const req = new Request("http://localhost/api/workflows/ingest-repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: "octocat", repo: "drag" }),
      });

      const res = await ingestRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.runId).toBe("run-test-123");
      expect(mockStart).toHaveBeenCalledWith(
        expect.anything(),
        [
          expect.objectContaining({
            owner: "octocat",
            repo: "drag",
            authToken: "gho_validServerSessionToken",
          }),
        ],
      );
    });
  });
});
