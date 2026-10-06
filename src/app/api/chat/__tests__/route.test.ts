import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
      getAccessToken: vi.fn(),
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

vi.mock("@/db/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [],
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (cb: any) =>
      cb({
        select: () => ({
          from: () => ({
            where: () => ({
              for: async () => [],
              limit: async () => [],
            }),
          }),
        }),
        insert: () => ({
          values: () => ({ onConflictDoUpdate: async () => undefined }),
        }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
  },
}));

const mockRollbackMonthlyQueryQuota = vi.fn();
vi.mock("@/lib/plans/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plans/entitlements")>();
  return {
    ...actual,
    rollbackMonthlyQueryQuota: (...args: any[]) => mockRollbackMonthlyQueryQuota(...args),
  };
});

const mockAnswerConversation = vi.fn();
const mockDefaultDeps = vi.fn();
vi.mock("@/lib/chat/conversation", () => ({
  answerConversation: (...args: any[]) => mockAnswerConversation(...args),
  defaultConversationChatDeps: (...args: any[]) => mockDefaultDeps(...args),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultDeps.mockReturnValue({ marker: "default-deps" });
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: Date.now() + 60000,
    });
  });

  it("returns 401 if user is not authenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const response = await POST(
      makeRequest({ conversationId: "conv-1", message: "hello" }),
    );

    expect(response.status).toBe(401);
    expect(mockAnswerConversation).not.toHaveBeenCalled();
  });

  it("returns 400 if conversationId is missing", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);

    const response = await POST(makeRequest({ message: "hello" }));

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing conversationId");
    expect(mockAnswerConversation).not.toHaveBeenCalled();
  });

  it("returns 400 if message is missing", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);

    const response = await POST(
      makeRequest({ conversationId: "conv-1" }),
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing message");
    expect(mockAnswerConversation).not.toHaveBeenCalled();
  });

  it("returns 400 if message exceeds maximum allowed length", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);

    const longMessage = "a".repeat(4001);
    const response = await POST(
      makeRequest({ conversationId: "conv-1", message: longMessage }),
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("exceeds maximum allowed length");
    expect(mockAnswerConversation).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 45000,
    });

    const response = await POST(
      makeRequest({ conversationId: "conv-1", message: "hello" }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeDefined();
    const data = await response.json();
    expect(data.error).toContain("Rate limit exceeded");
    expect(mockAnswerConversation).not.toHaveBeenCalled();
  });

  it("forwards parsed body and default deps to answerConversation and maps failure status", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockAnswerConversation.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "Forbidden: You do not have access to this repository on GitHub",
    });

    const response = await POST(
      makeRequest({ conversationId: "conv-1", message: "explain alpha" }),
    );

    expect(mockDefaultDeps).toHaveBeenCalledTimes(1);
    expect(mockAnswerConversation).toHaveBeenCalledWith(
      { marker: "default-deps" },
      expect.objectContaining({
        userId: "user-1",
        conversationId: "conv-1",
        message: "explain alpha",
        responseMode: "precise",
        getGithubToken: expect.any(Function),
      }),
    );

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("Forbidden");
  });

  it("forwards validated responseMode to answerConversation", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockAnswerConversation.mockResolvedValueOnce({
      ok: true,
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });

    await POST(
      makeRequest({
        conversationId: "conv-1",
        message: "explain",
        responseMode: "explain_simply",
      }),
    );

    expect(mockAnswerConversation).toHaveBeenCalledWith(
      { marker: "default-deps" },
      expect.objectContaining({
        responseMode: "explain_simply",
      }),
    );
  });

  it("maps a successful result to a streaming Response with the text/plain headers", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    const stubStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello world"));
        controller.close();
      },
    });
    mockAnswerConversation.mockResolvedValueOnce({ ok: true, stream: stubStream });

    const response = await POST(
      makeRequest({ conversationId: "conv-1", message: "hello" }),
    );

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(await response.text()).toBe("Hello world");
  });

  it("rolls back the consumed query when answerConversation throws before streaming", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } } as any);
    mockAnswerConversation.mockRejectedValueOnce(new Error("retriever exploded"));

    const response = await POST(
      makeRequest({ conversationId: "conv-1", message: "hello" }),
    );

    expect(response.status).toBe(500);
    expect(mockRollbackMonthlyQueryQuota).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("skips rollback for unmetered plans where nothing was consumed", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "boss-user" } } as any);
    // null monthlyQueryLimit => unmetered => checkAndConsume short-circuits without consuming
    mockAnswerConversation.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const entitlementsModule = await import("@/lib/plans/entitlements");
    const spy = vi
      .spyOn(entitlementsModule, "getUserEntitlements")
      .mockResolvedValueOnce({
        plan: "boss",
        repositoryLimit: Number.MAX_SAFE_INTEGER,
        monthlyQueryLimit: null,
        repositorySizeLimitBytes: Number.MAX_SAFE_INTEGER,
        fileLimit: Number.MAX_SAFE_INTEGER,
        allowedBranch: "*",
        incrementalReindexAllowed: true,
      });

    try {
      const response = await POST(
        makeRequest({ conversationId: "conv-1", message: "hello" }),
      );
      expect(response.status).toBe(403);
      expect(mockRollbackMonthlyQueryQuota).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
