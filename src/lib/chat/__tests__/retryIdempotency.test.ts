import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { answerConversation, ConversationChatDeps } from "../conversation";
import type { RetrievedChunk } from "@/lib/retrieval/retriever";
import type { ChatMessage } from "@/lib/llm/llmProvider";

const dialect = new PgDialect();

/** Renders a captured Drizzle where-clause so the test asserts on real SQL, not shape. */
function whereSql(condition: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condition as never);
}

function makeStubDb(selectQueue: Array<Promise<any[]>>) {
  const selectCalls: any[][] = [];
  const inserts: Array<{ values: Record<string, unknown> }> = [];
  const deletes: Array<{ where: unknown }> = [];
  const updates: Array<{ set: Record<string, unknown>; where: unknown }> = [];

  const db = {
    select: (...args: any[]) => {
      selectCalls.push(args);
      const result = selectQueue.shift() ?? Promise.resolve([]);
      return {
        from: (_table: unknown) => ({
          where: (_cond: unknown) => ({
            limit: async () => await result,
            orderBy: (_order: unknown) => ({
              limit: async () => await result,
            }),
          }),
        }),
      };
    },
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ values });
        const id = `msg-${inserts.length}`;
        return {
          returning: async () => [
            {
              id,
              createdAt: new Date(),
              updatedAt: new Date(),
              citations: null,
              ...values,
            },
          ],
          onConflictDoUpdate: async () => undefined,
        };
      },
    }),
    delete: (_table: unknown) => ({
      where: (where: unknown) => {
        deletes.push({ where });
        return Promise.resolve(undefined);
      },
    }),
    update: (_table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          updates.push({ set, where });
          const ret = [
            {
              id: "target-assistant-1",
              createdAt: new Date(),
              updatedAt: new Date(),
              citations: null,
              ...set,
            },
          ];
          return Object.assign(Promise.resolve(undefined), {
            returning: async () => ret,
          });
        },
      }),
    }),
  };

  return { db, selectCalls, inserts, deletes, updates };
}

const fixtureChunks: RetrievedChunk[] = [
  {
    id: "chunk-1",
    repositoryId: "repo-1",
    filePath: "src/a.ts",
    language: "typescript",
    chunkType: "function",
    symbolName: "alpha",
    startLine: 1,
    endLine: 10,
    text: "export function alpha() {}",
    similarity: 0.9,
  },
];

describe("Chat Retry & Idempotency Audit (5D)", () => {
  it("does not insert a duplicate user message when retrying a failed message", async () => {
    // 1: conv, 2: repo, 3: access cache, 4: history (including the previous user message)
    const selectQueue = [
      Promise.resolve([{ id: "conv-1", repositoryId: "repo-1", userId: "user-1" }]),
      Promise.resolve([{ id: "repo-1", owner: "octocat", name: "drag" }]),
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1", hasAccess: true, verifiedAt: new Date() }]),
      Promise.resolve([
        { role: "user", content: "How does auth work?" },
      ]),
    ];

    const { db, inserts, deletes } = makeStubDb(selectQueue);
    let capturedLlmMessages: ChatMessage[] = [];

    const deps: ConversationChatDeps = {
      database: db as any,
      embedQuery: async () => [0.1, 0.2, 0.3],
      retrieve: async () => fixtureChunks,
      streamLLM: async (messages) => {
        capturedLlmMessages = messages;
        return (async function* () {
          yield "Auth ";
          yield "works.";
        })();
      },
    };

    const result = await answerConversation(deps, {
      userId: "user-1",
      conversationId: "conv-1",
      message: "How does auth work?",
      isRetry: true,
      retryMessageId: "failed-msg-123",
      getGithubToken: async () => "token-1",
    });

    expect(result.ok).toBe(true);

    // Verified: Exactly 1 insert (the assistant message), ZERO duplicate user message insert
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values.role).toBe("assistant");
    expect(inserts[0].values.status).toBe("streaming");

    // Verified: The previous failed message was deleted
    expect(deletes).toHaveLength(1);

    // Verified: The delete is scoped to this conversation's own failed assistant turn.
    // `retryMessageId` is client-supplied, so an ID-only filter let any authenticated
    // user delete another conversation's message.
    const del = whereSql(deletes[0].where);
    expect(del.sql).toContain('"messages"."conversation_id" = $2');
    expect(del.sql).toContain('"messages"."role" = $3');
    expect(del.sql).toContain('"messages"."status" = $4');
    expect(del.params).toEqual(["failed-msg-123", "conv-1", "assistant", "failed"]);

    // Verified: Prompt was not duplicated in LLM messages
    const userRoleMessages = capturedLlmMessages.filter((m) => m.role === "user");
    expect(userRoleMessages).toHaveLength(1);
    expect(userRoleMessages[0].content).toBe("How does auth work?");
  });

  it("cannot delete a completed assistant message supplied as retryMessageId", async () => {
    const selectQueue = [
      Promise.resolve([{ id: "conv-1", repositoryId: "repo-1", userId: "user-1" }]),
      Promise.resolve([{ id: "repo-1", owner: "octocat", name: "drag" }]),
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1", hasAccess: true, verifiedAt: new Date() }]),
      Promise.resolve([]),
    ];

    const { db, deletes } = makeStubDb(selectQueue);

    const deps: ConversationChatDeps = {
      database: db as any,
      embedQuery: async () => [0.1, 0.2, 0.3],
      retrieve: async () => fixtureChunks,
      streamLLM: async () =>
        (async function* () {
          yield "Result";
        })(),
    };

    await answerConversation(deps, {
      userId: "user-1",
      conversationId: "conv-1",
      message: "First query",
      isRetry: true,
      // A completed assistant message of this conversation: the status filter must exclude it.
      retryMessageId: "completed-msg-999",
      getGithubToken: async () => "token-1",
    });

    expect(deletes).toHaveLength(1);
    expect(whereSql(deletes[0].where).params).toEqual([
      "completed-msg-999",
      "conv-1",
      "assistant",
      "failed",
    ]);
  });

  it("inserts both user and assistant messages during regular non-retry execution", async () => {
    const selectQueue = [
      Promise.resolve([{ id: "conv-1", repositoryId: "repo-1", userId: "user-1" }]),
      Promise.resolve([{ id: "repo-1", owner: "octocat", name: "drag" }]),
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1", hasAccess: true, verifiedAt: new Date() }]),
      Promise.resolve([]),
    ];

    const { db, inserts, deletes } = makeStubDb(selectQueue);

    const deps: ConversationChatDeps = {
      database: db as any,
      embedQuery: async () => [0.1, 0.2, 0.3],
      retrieve: async () => fixtureChunks,
      streamLLM: async () =>
        (async function* () {
          yield "Result";
        })(),
    };

    const result = await answerConversation(deps, {
      userId: "user-1",
      conversationId: "conv-1",
      message: "First query",
      getGithubToken: async () => "token-1",
    });

    expect(result.ok).toBe(true);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values.role).toBe("user");
    expect(inserts[1].values.role).toBe("assistant");
    expect(deletes).toHaveLength(0);
  });

  it("replaces the authorized assistant message and builds history only up to its user prompt", async () => {
    const t2 = new Date("2026-01-01T00:01:00Z");
    const t3 = new Date("2026-01-01T00:01:10Z");

    const selectQueue = [
      Promise.resolve([{ id: "conv-1", repositoryId: "repo-1", userId: "user-1" }]),
      Promise.resolve([{ id: "repo-1", owner: "octocat", name: "drag" }]),
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1", hasAccess: true, verifiedAt: new Date() }]),
      // 4: target assistant message
      Promise.resolve([
        { id: "a-1", conversationId: "conv-1", role: "assistant", status: "completed", createdAt: t3 },
      ]),
      // 5: user prompt preceding target assistant message
      Promise.resolve([
        { id: "u-1", conversationId: "conv-1", role: "user", content: "What is X?", createdAt: t2 },
      ]),
      // 6: history query returns completed messages before u-1 (descending)
      Promise.resolve([
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "Earlier question" },
      ]),
    ];

    const { db, inserts, deletes, updates } = makeStubDb(selectQueue);
    let capturedLlmMessages: ChatMessage[] = [];

    const deps: ConversationChatDeps = {
      database: db as any,
      embedQuery: async () => [0.1, 0.2, 0.3],
      retrieve: async () => fixtureChunks,
      streamLLM: async (messages) => {
        capturedLlmMessages = messages;
        return (async function* () {
          yield "New answer";
        })();
      },
    };

    const result = await answerConversation(deps, {
      userId: "user-1",
      conversationId: "conv-1",
      message: "What is X?",
      isRegenerate: true,
      regenerateMessageId: "a-1",
      getGithubToken: async () => "token-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const reader = result.stream.getReader();
      while (!(await reader.read()).done) {}
    }

    // ZERO inserts: does not insert a new user prompt or an extra assistant bubble
    expect(inserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);

    // Replaces the authorized assistant message row in place with atomic claim
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].set.status).toBe("streaming");
    expect(typeof updates[0].set.attemptId).toBe("string");
    expect(updates[0].set.attemptId).toBeTruthy();

    const claimWhere = whereSql(updates[0].where);
    expect(claimWhere.params).toEqual(["a-1", "streaming"]);
    expect(claimWhere.sql).toContain('"status" <> $2');

    // Completion write requires the same attempt ID
    const completionUpdate = updates.find((u) => u.set.status === "completed");
    expect(completionUpdate).toBeDefined();
    const completionWhere = whereSql(completionUpdate!.where);
    expect(completionWhere.params).toEqual(["target-assistant-1", updates[0].set.attemptId]);
    expect(completionWhere.sql).toContain('"attempt_id" = $2');

    // Model history contains earlier turn plus current prompt, no duplication
    const userRoleMessages = capturedLlmMessages.filter((m) => m.role === "user");
    expect(userRoleMessages).toHaveLength(2);
    expect(userRoleMessages[0].content).toBe("Earlier question");
    expect(userRoleMessages[1].content).toBe("What is X?");
  });

  it("returns 409 when target assistant message is already streaming", async () => {
    const selectQueue = [
      Promise.resolve([{ id: "conv-1", repositoryId: "repo-1", userId: "user-1" }]),
      Promise.resolve([{ id: "repo-1", owner: "octocat", name: "drag" }]),
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1", hasAccess: true, verifiedAt: new Date() }]),
      // Target assistant message is currently streaming
      Promise.resolve([{ id: "a-1", conversationId: "conv-1", role: "assistant", status: "streaming", createdAt: new Date() }]),
    ];

    const { db } = makeStubDb(selectQueue);

    const deps: ConversationChatDeps = {
      database: db as any,
      embedQuery: async () => [0.1, 0.2, 0.3],
      retrieve: async () => fixtureChunks,
      streamLLM: async () => (async function* () {})(),
    };

    const result = await answerConversation(deps, {
      userId: "user-1",
      conversationId: "conv-1",
      message: "What is X?",
      isRegenerate: true,
      regenerateMessageId: "a-1",
      getGithubToken: async () => "token-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("already being regenerated");
    }
  });

  it("returns 404 when regenerateMessageId is not found or unauthorized", async () => {
    const selectQueue = [
      Promise.resolve([{ id: "conv-1", repositoryId: "repo-1", userId: "user-1" }]),
      Promise.resolve([{ id: "repo-1", owner: "octocat", name: "drag" }]),
      Promise.resolve([{ userId: "user-1", repositoryId: "repo-1", hasAccess: true, verifiedAt: new Date() }]),
      // Target assistant message query returns nothing (not found or unauthorized)
      Promise.resolve([]),
    ];

    const { db } = makeStubDb(selectQueue);

    const deps: ConversationChatDeps = {
      database: db as any,
      embedQuery: async () => [0.1, 0.2, 0.3],
      retrieve: async () => fixtureChunks,
      streamLLM: async () => (async function* () {})(),
    };

    const result = await answerConversation(deps, {
      userId: "user-1",
      conversationId: "conv-1",
      message: "What is X?",
      isRegenerate: true,
      regenerateMessageId: "unauthorized-or-missing-id",
      getGithubToken: async () => "token-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
