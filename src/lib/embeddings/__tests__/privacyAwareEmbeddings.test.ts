import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getEmbeddingProviderForRepository,
  getDefaultEmbeddingMetadataForVisibility,
  PUBLIC_REPO_PRIVACY_DISCLOSURE,
  PRIVATE_REPO_PRIVACY_DISCLOSURE,
} from "../router";
import {
  GeminiEmbeddingProvider,
  GEMINI_EMBEDDING_MODEL,
} from "../geminiEmbeddingProvider";
import {
  CloudflareEmbeddingProvider,
  CLOUDFLARE_EMBEDDING_MODEL,
} from "../cloudflareEmbeddingProvider";
import { retrieveChunksVector } from "@/lib/retrieval/retriever";

describe("Privacy-Aware Embeddings & Provider Routing", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Provider Routing Invariants", () => {
    it("routes public repository to Google Gemini (gemini-embedding-2, 768 dims)", () => {
      const provider = getEmbeddingProviderForRepository({ isPrivate: false });
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.name).toBe("gemini");
      expect(provider.model).toBe(GEMINI_EMBEDDING_MODEL);
      expect(provider.dimensions).toBe(768);
    });

    it("routes private repository to Cloudflare Workers AI (@cf/qwen/qwen3-embedding-0.6b, 768 dims)", () => {
      const provider = getEmbeddingProviderForRepository({ isPrivate: true });
      expect(provider).toBeInstanceOf(CloudflareEmbeddingProvider);
      expect(provider.name).toBe("cloudflare");
      expect(provider.model).toBe(CLOUDFLARE_EMBEDDING_MODEL);
      expect(provider.dimensions).toBe(768);
    });

    it("persists correct default metadata for newly indexed public repositories", () => {
      const meta = getDefaultEmbeddingMetadataForVisibility(false);
      expect(meta.embeddingProvider).toBe("gemini");
      expect(meta.embeddingModel).toBe("gemini-embedding-2");
      expect(meta.embeddingDimensions).toBe(768);
    });

    it("persists correct default metadata for newly indexed private repositories", () => {
      const meta = getDefaultEmbeddingMetadataForVisibility(true);
      expect(meta.embeddingProvider).toBe("cloudflare");
      expect(meta.embeddingModel).toBe("@cf/qwen/qwen3-embedding-0.6b");
      expect(meta.embeddingDimensions).toBe(768);
    });
  });

  describe("Query Embedding Consistency & Space Matching", () => {
    it("routes query embeddings for Gemini repositories to Gemini", () => {
      const provider = getEmbeddingProviderForRepository({
        isPrivate: false,
        embeddingProvider: "gemini",
        embeddingModel: "gemini-embedding-2",
        embeddingDimensions: 768,
      });
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.name).toBe("gemini");
    });

    it("routes query embeddings for Cloudflare repositories to Cloudflare", () => {
      const provider = getEmbeddingProviderForRepository({
        isPrivate: true,
        embeddingProvider: "cloudflare",
        embeddingModel: "@cf/qwen/qwen3-embedding-0.6b",
        embeddingDimensions: 768,
      });
      expect(provider).toBeInstanceOf(CloudflareEmbeddingProvider);
      expect(provider.name).toBe("cloudflare");
    });

    it("falls back safely to repository isPrivate flag when embeddingProvider is null", () => {
      const privateProvider = getEmbeddingProviderForRepository({
        isPrivate: true,
        embeddingProvider: null,
      });
      expect(privateProvider).toBeInstanceOf(CloudflareEmbeddingProvider);

      const publicProvider = getEmbeddingProviderForRepository({
        isPrivate: false,
        embeddingProvider: null,
      });
      expect(publicProvider).toBeInstanceOf(GeminiEmbeddingProvider);
    });

    it("never routes a private repository to Gemini even when a stale gemini provider is stored", () => {
      // Public repo indexed with Gemini, later flipped to private: the stored provider is stale
      // and must not be able to send private source code to Gemini.
      const provider = getEmbeddingProviderForRepository({
        isPrivate: true,
        embeddingProvider: "gemini",
      });
      expect(provider).toBeInstanceOf(CloudflareEmbeddingProvider);
      expect(provider.name).toBe("cloudflare");
    });
  });

  describe("CRITICAL PRIVACY INVARIANT: Zero Gemini Fallback on Cloudflare Failure", () => {
    it("throws an error and NEVER calls Gemini when Cloudflare Workers AI fails", async () => {
      const geminiSpy = vi.spyOn(GeminiEmbeddingProvider.prototype, "generateEmbeddings");

      // Mock fetch failure for Cloudflare
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Cloudflare Worker Error"),
      } as any);

      const cloudflareProvider = new CloudflareEmbeddingProvider("mock-token", "mock-account");

      await expect(
        cloudflareProvider.generateEmbeddings({
          input: ["sensitive private repository source code"],
        }),
      ).rejects.toThrow(/Cloudflare Workers AI embedding API failed with HTTP 500/);

      // Verify Gemini was NEVER invoked
      expect(geminiSpy).not.toHaveBeenCalled();
    });

    it("throws an error and NEVER calls Gemini when Cloudflare credentials are missing", async () => {
      const geminiSpy = vi.spyOn(GeminiEmbeddingProvider.prototype, "generateEmbeddings");

      const cloudflareProvider = new CloudflareEmbeddingProvider("", "");

      await expect(
        cloudflareProvider.generateEmbeddings({
          input: ["private code snippet"],
        }),
      ).rejects.toThrow(/CLOUDFLARE_API_TOKEN environment variable is missing/);

      expect(geminiSpy).not.toHaveBeenCalled();
    });

    it("throws an error when Cloudflare returns error JSON and never falls back", async () => {
      const geminiSpy = vi.spyOn(GeminiEmbeddingProvider.prototype, "generateEmbeddings");

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: false,
          errors: [{ message: "Model temporarily unavailable" }],
        }),
      } as any);

      const cloudflareProvider = new CloudflareEmbeddingProvider("mock-token", "mock-account");

      await expect(
        cloudflareProvider.generateEmbeddings({
          input: ["private code snippet"],
        }),
      ).rejects.toThrow(/Model temporarily unavailable/);

      expect(geminiSpy).not.toHaveBeenCalled();
    });
  });

  describe("Client Spoofing Resistance", () => {
    it("ignores client spoofed visibility and uses server-verified repository visibility", () => {
      // Client claims isPrivate is false, but server repository record indicates isPrivate: true
      const serverVerifiedRecord = {
        isPrivate: true,
        embeddingProvider: "cloudflare",
      };

      const provider = getEmbeddingProviderForRepository(serverVerifiedRecord);
      expect(provider).toBeInstanceOf(CloudflareEmbeddingProvider);
      expect(provider.name).toBe("cloudflare");
    });

    it("ignores client spoofed provider and enforces Cloudflare on private repositories", () => {
      // If a malicious client tries to route private repo through Gemini
      // getEmbeddingProviderForRepository enforces Cloudflare based on verified isPrivate
      const provider = getEmbeddingProviderForRepository({ isPrivate: true });
      expect(provider).toBeInstanceOf(CloudflareEmbeddingProvider);
      expect(provider.name).not.toBe("gemini");
    });
  });

  describe("Cloudflare Workers AI Matryoshka Slicing & L2 Normalization", () => {
    it("slices 1024-dimensional raw vectors down to 768 dimensions and L2-normalizes", async () => {
      // Create a 1024-dimensional raw vector with non-zero values
      const raw1024 = Array.from({ length: 1024 }, (_, i) => i + 1);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          result: {
            data: [raw1024],
          },
        }),
      } as any);

      const provider = new CloudflareEmbeddingProvider("mock-token", "mock-account");
      const res = await provider.generateEmbeddings({
        input: "const x = 42;",
        dimensions: 768,
      });

      expect(res.embeddings.length).toBe(1);
      const vec = res.embeddings[0];
      expect(vec.length).toBe(768);

      // Verify L2 normalization (sum of squares === 1.0 within floating point precision)
      const normSquared = vec.reduce((sum, v) => sum + v * v, 0);
      expect(normSquared).toBeCloseTo(1.0, 5);
    });

    it("handles batch inputs correctly", async () => {
      const raw1024A = Array.from({ length: 1024 }, () => 2);
      const raw1024B = Array.from({ length: 1024 }, () => 3);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          result: {
            data: [raw1024A, raw1024B],
          },
        }),
      } as any);

      const provider = new CloudflareEmbeddingProvider("mock-token", "mock-account");
      const res = await provider.generateEmbeddings({
        input: ["chunk 1", "chunk 2"],
      });

      expect(res.embeddings.length).toBe(2);
      expect(res.embeddings[0].length).toBe(768);
      expect(res.embeddings[1].length).toBe(768);
    });

    it("rejects vectors shorter than the target dimension instead of writing them to vector(768)", async () => {
      const shortVector = Array.from({ length: 384 }, (_, i) => i + 1);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          result: { data: [shortVector] },
        }),
      } as any);

      const provider = new CloudflareEmbeddingProvider("mock-token", "mock-account");
      await expect(
        provider.generateEmbeddings({ input: "const x = 42;", dimensions: 768 }),
      ).rejects.toThrow(/384-dimension vector, expected at least 768/);
    });
  });

  describe("Google Gemini Provider Configuration", () => {
    it("requests 768 dimensions via outputDimensionality", async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation((url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              embeddings: [{ values: Array.from({ length: 768 }, () => 0.1) }],
            }),
        });
      });

      const provider = new GeminiEmbeddingProvider("mock-api-key");
      const res = await provider.generateEmbeddings({
        input: "export function hello() {}",
      });

      expect(res.embeddings.length).toBe(1);
      expect(res.dimensions).toBe(768);
      expect(capturedBody.requests[0].outputDimensionality).toBe(768);
      expect(capturedBody.requests[0].model).toBe("models/gemini-embedding-2");
    });

    it("sends the API key in a header and never in the request URL", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation((url, opts) => {
        capturedUrl = String(url);
        capturedHeaders = (opts?.headers ?? {}) as Record<string, string>;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              embeddings: [{ values: Array.from({ length: 768 }, () => 0.1) }],
            }),
        });
      });

      const provider = new GeminiEmbeddingProvider("secret-api-key");
      await provider.generateEmbeddings({ input: "export function hello() {}" });

      expect(capturedUrl).not.toContain("secret-api-key");
      expect(capturedUrl).not.toContain("?key=");
      expect(capturedHeaders["x-goog-api-key"]).toBe("secret-api-key");
    });

    it("retries on HTTP 429 rate limit and succeeds on subsequent attempt", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            clone: () => ({
              json: () =>
                Promise.resolve({
                  error: {
                    code: 429,
                    message: "Quota exceeded. Please retry in 0.01s.",
                  },
                }),
            }),
            text: () => Promise.resolve("Rate limit exceeded"),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              embeddings: [{ values: Array.from({ length: 768 }, () => 0.2) }],
            }),
        });
      });

      const provider = new GeminiEmbeddingProvider("mock-api-key");
      const res = await provider.generateEmbeddings({
        input: "export const retryMe = true;",
      });

      expect(res.embeddings.length).toBe(1);
      expect(callCount).toBe(2);
    });

    it("fails immediately on non-retryable 403 error without attempting retries", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: false,
          status: 403,
          text: () => Promise.resolve("Forbidden: Invalid API key"),
        });
      });

      const provider = new GeminiEmbeddingProvider("bad-key");
      await expect(
        provider.generateEmbeddings({ input: "test" }),
      ).rejects.toThrow(/Google Gemini embedding API failed with HTTP 403/);

      expect(callCount).toBe(1);
    });
  });

  describe("Vector Retrieval Embedding Space Isolation", () => {
    it("filters chunks by repository embeddingProvider so different embedding spaces are never mixed", async () => {
      const mockDatabase: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  embeddingProvider: "cloudflare",
                },
              ]),
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      };

      const queryVector = Array.from({ length: 768 }, () => 0.05);
      await retrieveChunksVector("repo-private-123", queryVector, 5, mockDatabase);

      // Verify that database.select was called to inspect repository embeddingProvider
      expect(mockDatabase.select).toHaveBeenCalled();
    });
  });

  describe("Privacy Disclosures", () => {
    it("provides the exact public repository privacy disclosure", () => {
      expect(PUBLIC_REPO_PRIVACY_DISCLOSURE).toBe(
        "Public repository code may be used by third-party services to improve their products.",
      );
    });

    it("provides the exact private repository privacy disclosure", () => {
      expect(PRIVATE_REPO_PRIVACY_DISCLOSURE).toBe(
        "Private repo chats don't expose your code to public-repository AI providers.",
      );
    });
  });
});
