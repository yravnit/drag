import { describe, it, expect, vi } from "vitest";
import { logStructuredEvent } from "../logger";

describe("Observability Structured Logger", () => {
  it("formats single-line JSON log entry with DRAG_OBSERVABILITY tag", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logStructuredEvent({
      event: "chat_retrieval",
      durationMs: 42,
      repositoryId: "repo-123",
      resultCount: 5,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0][0];

    expect(logged).toContain("[DRAG_OBSERVABILITY]");
    const jsonStr = logged.replace("[DRAG_OBSERVABILITY] ", "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.event).toBe("chat_retrieval");
    expect(parsed.durationMs).toBe(42);
    expect(parsed.repositoryId).toBe("repo-123");
    expect(parsed.resultCount).toBe(5);
    expect(parsed.timestamp).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("serializes correlated traceId and RAG metadata across pipeline stages", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const traceId = "test-trace-uuid";
    logStructuredEvent({
      event: "chat_retrieval",
      traceId,
      durationMs: 55,
      repositoryId: "repo-456",
      conversationId: "conv-789",
      resultCount: 8,
      retrievalStrategy: "hybrid_rrf",
      contextCharCount: 4200,
      citationsCount: 6,
    });

    logStructuredEvent({
      event: "chat_llm_stream",
      traceId,
      durationMs: 350,
      conversationId: "conv-789",
      repositoryId: "repo-456",
      status: "completed",
      citationsCount: 6,
      responseCharCount: 1250,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(2);

    const retrievalEntry = JSON.parse(
      consoleSpy.mock.calls[0][0].replace("[DRAG_OBSERVABILITY] ", ""),
    );
    expect(retrievalEntry.traceId).toBe(traceId);
    expect(retrievalEntry.retrievalStrategy).toBe("hybrid_rrf");
    expect(retrievalEntry.contextCharCount).toBe(4200);
    expect(retrievalEntry.citationsCount).toBe(6);

    const streamEntry = JSON.parse(
      consoleSpy.mock.calls[1][0].replace("[DRAG_OBSERVABILITY] ", ""),
    );
    expect(streamEntry.traceId).toBe(traceId);
    expect(streamEntry.responseCharCount).toBe(1250);
    expect(streamEntry.status).toBe("completed");

    consoleSpy.mockRestore();
  });
});
