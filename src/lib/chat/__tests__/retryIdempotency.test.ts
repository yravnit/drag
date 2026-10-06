import { describe, it, expect } from "vitest";
import { answerConversation, ConversationChatDeps } from "../conversation";
import type { RetrievedChunk } from "@/lib/retrieval/retriever";
import type { ChatMessage } from "@/lib/llm/llmProvider";

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
          return Promise.resolve(undefined);
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

    // Verified: Prompt was not duplicated in LLM messages
    const userRoleMessages = capturedLlmMessages.filter((m) => m.role === "user");
    expect(userRoleMessages).toHaveLength(1);
    expect(userRoleMessages[0].content).toBe("How does auth work?");
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
});
