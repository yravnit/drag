import { describe, it, expect, vi } from "vitest";
import { logStructuredEvent, scrubSensitiveData } from "../logger";

describe("Observability Secret Scrubber Audit (5J)", () => {
  it("scrubs tokens, API keys, and sensitive headers from structured log payloads", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logStructuredEvent({
      event: "rate_limit_exceeded",
      apiKey: "nvapi-secret-key-1234567890",
      authToken: "ghp_superSecretGitHubToken12345",
      authorization: "Bearer secret-token",
      error: "Failed with key nvapi-abc123xyz",
    } as any);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logged.replace("[DRAG_OBSERVABILITY] ", ""));

    expect(parsed.apiKey).toBe("[REDACTED]");
    expect(parsed.authToken).toBe("[REDACTED]");
    expect(parsed.authorization).toBe("[REDACTED]");
    expect(parsed.error).toBe("[REDACTED]");

    consoleSpy.mockRestore();
  });

  it("safely handles non-sensitive metadata without redacting legitimate fields", () => {
    const cleanPayload = {
      event: "chat_retrieval",
      durationMs: 42,
      repositoryId: "repo-uuid-1",
      retrievalStrategy: "hybrid_rrf",
    };

    const scrubbed = scrubSensitiveData(cleanPayload) as typeof cleanPayload;
    expect(scrubbed.durationMs).toBe(42);
    expect(scrubbed.repositoryId).toBe("repo-uuid-1");
    expect(scrubbed.retrievalStrategy).toBe("hybrid_rrf");
  });
});
