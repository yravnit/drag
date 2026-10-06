import { describe, it, expect, vi, beforeEach } from "vitest";
import { EMBEDDING_CONFIG, SUPPORTED_EMBEDDING_DIMENSIONS } from "../config";
import { NimEmbeddingProvider, generateEmbeddings } from "../embeddingProvider";

// Mock OpenAI SDK
const mockCreate = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      embeddings = {
        create: mockCreate,
      };
    },
  };
});

describe("Embedding Configuration", () => {
  it("defaults to llama-nemotron-embed-1b-v2 with 768 dimensions", () => {
    expect(EMBEDDING_CONFIG.model).toBe("nvidia/llama-nemotron-embed-1b-v2");
    expect(EMBEDDING_CONFIG.dimensions).toBe(768);
    expect(EMBEDDING_CONFIG.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(EMBEDDING_CONFIG.supportedDimensions).toEqual([384, 512, 768, 1024, 2048]);
  });
});

describe("NimEmbeddingProvider — Model & Dimension Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws an error if NVIDIA_API_KEY is missing or empty", async () => {
    const provider = new NimEmbeddingProvider("");

    await expect(
      provider.generateEmbeddings({ input: "Hello world" })
    ).rejects.toThrow("NVIDIA_API_KEY environment variable is missing");
  });

  it("calls NVIDIA NIM API via OpenAI SDK with correct model, input_type, and 768 dimensions", async () => {
    const mockEmbedding768 = Array.from({ length: 768 }, () => 0.123);
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: mockEmbedding768 }],
      usage: { total_tokens: 10 },
    });

    const provider = new NimEmbeddingProvider("test-api-key");
    const result = await provider.generateEmbeddings({
      input: ["function foo() {}"],
      dimensions: 768,
      inputType: "passage",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: "nvidia/llama-nemotron-embed-1b-v2",
      input: ["function foo() {}"],
      dimensions: 768,
      encoding_format: "float",
      input_type: "passage",
      truncate: "NONE",
    });

    expect(result.dimensions).toBe(768);
    expect(result.embeddings[0]).toHaveLength(768);
    expect(result.totalTokens).toBe(10);
  });

  it("supports all Matryoshka configurable vector dimensions (384, 512, 768, 1024, 2048)", async () => {
    const provider = new NimEmbeddingProvider("test-api-key");

    for (const dim of SUPPORTED_EMBEDDING_DIMENSIONS) {
      const mockVector = Array.from({ length: dim }, () => 0.01);
      mockCreate.mockResolvedValueOnce({
        data: [{ embedding: mockVector }],
        usage: { total_tokens: 5 },
      });

      const res = await provider.generateEmbeddings({
        input: `Sample chunk text for dim ${dim}`,
        dimensions: dim,
      });

      expect(res.dimensions).toBe(dim);
      expect(res.embeddings[0]).toHaveLength(dim);
      expect(mockCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dimensions: dim,
          model: "nvidia/llama-nemotron-embed-1b-v2",
          input_type: "passage",
          truncate: "NONE",
        })
      );
    }
  });

  it("handles multi-chunk batch inputs and verifies output vector lengths", async () => {
    const chunks = [
      "export function parseRepo() {}",
      "class SemanticChunker {}",
      "const vectorSize = 768;",
    ];

    mockCreate.mockResolvedValueOnce({
      data: [
        { embedding: Array.from({ length: 768 }, () => 0.1) },
        { embedding: Array.from({ length: 768 }, () => 0.2) },
        { embedding: Array.from({ length: 768 }, () => 0.3) },
      ],
      usage: { total_tokens: 42 },
    });

    const provider = new NimEmbeddingProvider("test-api-key");
    const result = await provider.generateEmbeddings({
      input: chunks,
      inputType: "passage",
    });

    expect(result.embeddings).toHaveLength(3);
    result.embeddings.forEach((emb) => {
      expect(emb).toHaveLength(768);
    });
  });

  it("works with generateEmbeddings helper function", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: Array.from({ length: 768 }, () => 0.999) }],
      usage: { total_tokens: 8 },
    });

    const result = await generateEmbeddings("query text", {
      dimensions: 768,
      inputType: "query",
    });

    expect(result.model).toBe("nvidia/llama-nemotron-embed-1b-v2");
    expect(result.dimensions).toBe(768);
    expect(result.embeddings[0]).toHaveLength(768);
  });

  it("handles 403 API errors with a descriptive authorization error", async () => {
    const error403 = new Error("403 status code (no body)");
    (error403 as any).status = 403;
    mockCreate.mockRejectedValueOnce(error403);

    const provider = new NimEmbeddingProvider("test-api-key");
    await expect(
      provider.generateEmbeddings({ input: "test" })
    ).rejects.toThrow("NVIDIA NIM API Authorization failed (HTTP 403 Forbidden)");
  });

  it("conforms to EmbeddingProvider interface and supports MockEmbeddingProvider", async () => {
    const { MockEmbeddingProvider } = await import("../embeddingProvider");
    const mock = new MockEmbeddingProvider();
    const result = await mock.generateEmbeddings({
      input: ["chunk1", "chunk2"],
      dimensions: 768,
    });

    expect(result.dimensions).toBe(768);
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(768);
    expect(result.model).toBe("mock-embedding-model");

    // Custom mock function
    const customMock = new MockEmbeddingProvider(async (_opts) => ({
      embeddings: [[0.5, 0.5]],
      model: "custom-mock",
      dimensions: 2,
    }));
    const customResult = await customMock.generateEmbeddings({ input: "test" });
    expect(customResult.model).toBe("custom-mock");
    expect(customResult.embeddings[0]).toEqual([0.5, 0.5]);
  });
});
