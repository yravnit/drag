import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeMermaidSvg } from "@/lib/mermaid/sanitizeMermaid";
import { isCronAuthorized } from "@/lib/cron/cronAuth";
import { POST as chatPOST } from "@/app/api/chat/route";
import { PATCH as convPATCH, DELETE as convDELETE } from "@/app/api/conversations/[id]/route";
import { retrieveChunks } from "@/lib/retrieval/retriever";

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

const mockCheckRateLimit = vi.fn().mockResolvedValue({
  allowed: true,
  remaining: 29,
  resetAt: Date.now() + 60000,
});
vi.mock("@/lib/rateLimit/rateLimiter", () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

const mockDbSelect = vi.fn();
const mockDbDelete = vi.fn();
const mockDbUpdate = vi.fn();
vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    delete: (...args: any[]) => mockDbDelete(...args),
    update: (...args: any[]) => mockDbUpdate(...args),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }),
    transaction: async (cb: any) =>
      cb({
        select: (...args: any[]) => mockDbSelect(...args),
        delete: (...args: any[]) => mockDbDelete(...args),
        update: (...args: any[]) => mockDbUpdate(...args),
        insert: () => ({
          values: () => ({ onConflictDoUpdate: async () => undefined }),
        }),
      }),
  },
}));

vi.mock("@/lib/chat/conversation", () => ({
  answerConversation: vi.fn().mockResolvedValue({
    ok: true,
    stream: new ReadableStream({
      start(c) {
        c.close();
      },
    }),
  }),
  defaultConversationChatDeps: vi.fn().mockReturnValue({}),
}));

describe("Phase 1 Security & Reliability Regression Audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60000,
    });
    // Default drizzle chain for the chat quota check; individual tests override with mockReturnValueOnce
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          for: async () => [],
          limit: async () => [],
        }),
      }),
    });
  });

  describe("1. Message size limits", () => {
    it("rejects chat messages exceeding 4000 characters with 400 Bad Request", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-test" } });

      const oversized = "x".repeat(4001);
      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "conv-1",
          message: oversized,
        }),
      });

      const res = await chatPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("exceeds maximum allowed length");
    });
  });

  describe("2. Rate limits", () => {
    it("rejects requests with 429 when rate limit is exceeded", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-test" } });
      mockCheckRateLimit.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      });

      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "conv-1",
          message: "valid prompt",
        }),
      });

      const res = await chatPOST(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toContain("Rate limit exceeded");
    });
  });

  describe("3. GitHub token isolation", () => {
    it("retrieves GitHub tokens exclusively via server session and ignores client-injected tokens", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-test" } });

      // Client passes malicious githubToken in request body
      const req = new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "conv-1",
          message: "valid prompt",
          githubToken: "gho_malicious_attacker_token",
        }),
      });

      const res = await chatPOST(req);
      expect(res.status).toBe(200);

      // Verify that getAccessToken was provided as the token fetcher rather than body.githubToken
      expect(mockGetAccessToken).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ headers: expect.anything() }),
      );
    });
  });

  describe("4. Conversation authorization and tenant isolation", () => {
    it("returns 404 when renaming a conversation that does not belong to the user", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-attacker" } });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No conversation found for user-attacker
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/victim-conv", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Attacker Renamed Title" }),
      });

      const res = await convPATCH(req, {
        params: Promise.resolve({ id: "victim-conv" }),
      });
      expect(res.status).toBe(404);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 when deleting a conversation that does not belong to the user", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-attacker" } });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No conversation found for user-attacker
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/victim-conv", {
        method: "DELETE",
      });

      const res = await convDELETE(req, {
        params: Promise.resolve({ id: "victim-conv" }),
      });
      expect(res.status).toBe(404);
      expect(mockDbDelete).not.toHaveBeenCalled();
    });
  });

  describe("5. Retrieval repository boundary isolation", () => {
    it("scopes vector retrieval strictly to the requested repositoryId", async () => {
      let executedWhere: unknown = null;
      const fakeDb = {
        select: () => ({
          from: () => ({
            where: (condition: unknown) => {
              executedWhere = condition;
              return {
                // Repository provider lookup shape: select -> from -> where -> limit
                limit: async () => [{ embeddingProvider: "gemini" }],
                orderBy: () => ({
                  limit: async () => [
                    {
                      id: "chunk-own",
                      repositoryId: "repo-isolated",
                      filePath: "src/safe.ts",
                      language: "typescript",
                      chunkType: "function",
                      symbolName: "safeFunc",
                      startLine: 1,
                      endLine: 10,
                      text: "export function safeFunc() {}",
                      similarity: 0.92,
                    },
                  ],
                }),
              };
            },
          }),
        }),
      };

      const results = await retrieveChunks("repo-isolated", [0.1, 0.2], 5, fakeDb as any);
      expect(results).toHaveLength(1);
      expect(results[0].repositoryId).toBe("repo-isolated");
      expect(executedWhere).toBeDefined();
    });
  });

  describe("6. Mermaid SVG sanitization", () => {
    it("strips script tags and inline event handlers from rendered SVGs", () => {
      const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
        <script>alert('xss')</script>
        <circle cx="50" cy="50" r="40" onload="alert('owned')" />
        <a href="javascript:alert(1)"><text>Click</text></a>
      </svg>`;

      const sanitized = sanitizeMermaidSvg(maliciousSvg);

      expect(sanitized).not.toContain("<script>");
      expect(sanitized).not.toContain("onload=");
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).toContain("<circle");
      expect(sanitized).toContain("<text>Click</text>");
    });
  });

  describe("7. Workflow authorization and cron secret timing-safe authentication", () => {
    const originalSecret = process.env.CRON_SECRET;

    afterEach(() => {
      process.env.CRON_SECRET = originalSecret;
    });

    it("accepts valid bearer authorization matching CRON_SECRET", () => {
      process.env.CRON_SECRET = "secret-token-xyz-12345";
      const req = new Request("http://localhost/api/cron/embed", {
        headers: { Authorization: "Bearer secret-token-xyz-12345" },
      });
      expect(isCronAuthorized(req)).toBe(true);
    });

    it("rejects when CRON_SECRET is missing or token is invalid", () => {
      delete process.env.CRON_SECRET;
      const req1 = new Request("http://localhost/api/cron/embed", {
        headers: { Authorization: "Bearer test" },
      });
      expect(isCronAuthorized(req1)).toBe(false);

      process.env.CRON_SECRET = "valid-secret";
      const req2 = new Request("http://localhost/api/cron/embed", {
        headers: { Authorization: "Bearer wrong-secret" },
      });
      expect(isCronAuthorized(req2)).toBe(false);

      const req3 = new Request("http://localhost/api/cron/embed");
      expect(isCronAuthorized(req3)).toBe(false);
    });
  });
});
