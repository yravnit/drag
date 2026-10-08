import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubApiClient } from "../githubApiClient";

describe("GitHub API Failure, Timeout & Rate-Limit Bounding (5C & 5F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bounds excessive Retry-After delay to prevent unbounded serverless execution hanging", async () => {
    // Simulate GitHub returning 429 with a 1-hour Retry-After header (3600 seconds)
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 429,
        headers: { "Retry-After": "3600" },
      }),
    );

    const client = new GitHubApiClient({
      maxRetries: 3,
      maxDelayMs: 2000,
      fetchFn: mockFetch,
    });

    const start = Date.now();
    const res = await client.fetchWithRetry("https://api.github.com/repos/test/repo");
    const duration = Date.now() - start;

    expect(res.status).toBe(429);
    // Verified: It did NOT sleep for 3600 seconds (1 hour); it returned immediately within bounded ms
    expect(duration).toBeLessThan(1000);
    // Verified: Only 1 fetch was made, because requestedDelay > maxDelayMs immediately aborts futile retry
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries transient 500 errors with backoff and succeeds on retry", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        return new Response(JSON.stringify({ message: "Internal server error" }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: 12345, name: "repo", owner: { login: "owner" } }), {
        status: 200,
      });
    });

    const client = new GitHubApiClient({
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 50,
      fetchFn: mockFetch,
    });

    const repo = await client.getRepository("owner", "repo");
    expect(repo.id).toBe(12345);
    expect(callCount).toBe(2);
  });

  it("does not retry permanent 404 client errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    );

    const client = new GitHubApiClient({
      maxRetries: 3,
      fetchFn: mockFetch,
    });

    await expect(client.getRepository("owner", "nonexistent")).rejects.toThrow(
      "GitHub API returned status 404",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries transient network connection errors", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("fetch failed: ECONNRESET");
      }
      return new Response(JSON.stringify({ id: 999, name: "repo", owner: { login: "owner" } }), {
        status: 200,
      });
    });

    const client = new GitHubApiClient({
      maxRetries: 2,
      baseDelayMs: 10,
      maxDelayMs: 50,
      fetchFn: mockFetch,
    });

    const repo = await client.getRepository("owner", "repo");
    expect(repo.id).toBe(999);
    expect(callCount).toBe(2);
  });
});
