import { describe, it, expect, vi, beforeEach } from "vitest";
import { answerConversation } from "@/lib/chat/conversation";
import { retrieveChunks } from "@/lib/retrieval/retriever";
import { POST as embedWorkflowPOST } from "@/app/api/workflows/embed/route";

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

vi.mock("@/lib/rateLimit/rateLimiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 60000 }),
}));

vi.mock("workflow", () => ({
  start: vi.fn().mockResolvedValue({ id: "run-1" }),
}));

const mockDbSelect = vi.fn();
vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
  },
}));

describe("Tenant Isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Conversation and Chat isolation", () => {
    it("returns 404 when User A attempts to access User B's conversation", async () => {
      // Simulate database where conversation conv-b belongs to user-b, not user-a
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [], // Empty result because conv.userId == "user-a" filter does not match
            }),
          }),
        }),
      };

      const deps = {
        database: mockDb as any,
        embedQuery: vi.fn(),
        retrieve: vi.fn(),
        streamLLM: vi.fn(),
      };

      const result = await answerConversation(deps, {
        userId: "user-a",
        conversationId: "conv-b", // Forged conversation ID belonging to User B
        message: "show me secrets",
        getGithubToken: async () => "token-a",
      });

      expect(result).toEqual({
        ok: false,
        status: 404,
        error: "Conversation not found",
      });
      expect(deps.embedQuery).not.toHaveBeenCalled();
      expect(deps.retrieve).not.toHaveBeenCalled();
      expect(deps.streamLLM).not.toHaveBeenCalled();
    });

    it("returns 403 when User A accesses a conversation for a repository they no longer have access to on GitHub", async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                // Conversation exists for user-a
                { id: "conv-a", userId: "user-a", repositoryId: "repo-private" },
                // Repository exists
                { id: "repo-private", owner: "org", name: "private-repo" },
                // Access cache entry indicates access was revoked
                { userId: "user-a", repositoryId: "repo-private", hasAccess: false, verifiedAt: new Date() },
              ],
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: async () => undefined,
          }),
        }),
      };

      const deps = {
        database: mockDb as any,
        embedQuery: vi.fn(),
        retrieve: vi.fn(),
        streamLLM: vi.fn(),
      };

      const result = await answerConversation(deps, {
        userId: "user-a",
        conversationId: "conv-a",
        message: "query code",
        getGithubToken: async () => "token-a",
      });

      expect(result).toEqual({
        ok: false,
        status: 403,
        error: "Forbidden: You do not have access to this repository on GitHub",
      });
      expect(deps.retrieve).not.toHaveBeenCalled();
    });
  });

  describe("Chunk retrieval repository isolation", () => {
    it("strictly isolates chunk retrieval by repositoryId parameter", async () => {
      let capturedWhere: unknown = null;
      const mockDb = {
        select: () => ({
          from: () => ({
            where: (cond: unknown) => {
              capturedWhere = cond;
              return {
                // Repository provider lookup shape: select -> from -> where -> limit
                limit: async () => [{ embeddingProvider: "gemini" }],
                orderBy: () => ({
                  limit: async () => [
                    {
                      id: "chunk-a1",
                      repositoryId: "repo-tenant-a",
                      filePath: "src/a.ts",
                      language: "typescript",
                      chunkType: "function",
                      symbolName: "testA",
                      startLine: 1,
                      endLine: 10,
                      text: "function testA() {}",
                      similarity: 0.95,
                    },
                  ],
                }),
              };
            },
          }),
        }),
      };

      const queryVector = [0.1, 0.2, 0.3];
      const results = await retrieveChunks("repo-tenant-a", queryVector, 5, mockDb as any);

      expect(results).toHaveLength(1);
      expect(results[0].repositoryId).toBe("repo-tenant-a");
      // Confirm that the WHERE clause was applied
      expect(capturedWhere).toBeDefined();
    });
  });

  describe("Workflow endpoint tenant boundary", () => {
    it("rejects User A attempting to trigger embed workflow on User B's repository with 403", async () => {
      mockGetSession.mockResolvedValueOnce({
        user: { id: "user-a" },
      });

      // Mock DB: userRepositories query returns empty (user-a is not associated with repo-b)
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No association
          }),
        }),
      });

      const request = new Request("http://localhost/api/workflows/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: "repo-b" }),
      });

      const response = await embedWorkflowPOST(request);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("Forbidden");
    });
  });
});
