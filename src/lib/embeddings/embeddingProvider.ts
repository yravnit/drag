import OpenAI from "openai";
import { EMBEDDING_CONFIG } from "./config";

export interface CreateEmbeddingsOptions {
  input: string | string[];
  dimensions?: number;
  model?: string;
  inputType?: "passage" | "query";
  truncate?: "NONE" | "START" | "END";
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  totalTokens?: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  generateEmbeddings(options: CreateEmbeddingsOptions): Promise<EmbeddingResult>;
}

/** NVIDIA NIM-specific extra parameters passed alongside the OpenAI-compatible body. */
interface NvidiaEmbeddingParams {
  input_type: string;
  truncate: string;
}

export class NimEmbeddingProvider implements EmbeddingProvider {
  public readonly name = "nvidia";
  public readonly model = EMBEDDING_CONFIG.model;
  public readonly dimensions = EMBEDDING_CONFIG.dimensions;
  private client: OpenAI | null = null;

  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl?: string,
  ) {}

  private getClient(): OpenAI {
    if (this.client) return this.client;

    const resolvedApiKey = this.apiKey !== undefined ? this.apiKey : EMBEDDING_CONFIG.apiKey;

    if (!resolvedApiKey || resolvedApiKey.trim() === "") {
      throw new Error(
        "NVIDIA_API_KEY environment variable is missing. Please set NVIDIA_API_KEY to generate embeddings.",
      );
    }

    const resolvedBaseUrl = this.baseUrl ?? EMBEDDING_CONFIG.baseUrl;
    this.client = new OpenAI({
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseUrl,
      // Generous timeout for batched embedding requests to NVIDIA NIM (slow cold-start)
      timeout: 120_000,
      maxRetries: 2,
    });

    return this.client;
  }

  /**
   * Generates dense vector embeddings using NVIDIA NIM API with configurable dimensions.
   * Supports Matryoshka embeddings for llama-nemotron-embed-1b-v2 (e.g., 384, 512, 768, 1024, 2048).
   */
  async generateEmbeddings(options: CreateEmbeddingsOptions): Promise<EmbeddingResult> {
    const client = this.getClient();
    const model = options.model ?? EMBEDDING_CONFIG.model;
    const dimensions = options.dimensions ?? EMBEDDING_CONFIG.dimensions;
    const inputType = options.inputType ?? "passage";
    const truncate = options.truncate ?? "NONE";

    const inputList = Array.isArray(options.input) ? options.input : [options.input];

    const nvidiaParams: NvidiaEmbeddingParams = {
      input_type: inputType,
      truncate,
    };

    try {
      const response = await client.embeddings.create({
        model,
        input: inputList,
        dimensions,
        encoding_format: "float",
        ...(nvidiaParams as unknown as Record<string, unknown>),
      });

      // Sort by index to guarantee embeddings[i] corresponds to inputList[i],
      // since the NVIDIA NIM API may return items in a different order.
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      const embeddings = sorted.map((item) => item.embedding);

      return {
        embeddings,
        model,
        dimensions,
        totalTokens: response.usage?.total_tokens,
      };
    } catch (error: unknown) {
      const err = error as { status?: number; statusCode?: number; message?: string };
      if (err?.status === 403 || err?.statusCode === 403) {
        throw new Error(
          `NVIDIA NIM API Authorization failed (HTTP 403 Forbidden): Invalid or expired NVIDIA_API_KEY. Please verify your API key at https://build.nvidia.com and update NVIDIA_API_KEY in .env.`,
        );
      }
      throw error;
    }
  }
}

/**
 * Convenient singleton helper to generate embeddings with default configuration.
 */
export async function generateEmbeddings(
  input: string | string[],
  options?: Omit<CreateEmbeddingsOptions, "input">,
): Promise<EmbeddingResult> {
  const provider = new NimEmbeddingProvider();
  return provider.generateEmbeddings({
    input,
    ...options,
  });
}

/**
 * In-memory mock embedding provider for tests and local development.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly name = "mock";
  public readonly model = "mock-embedding-model";
  public readonly dimensions = EMBEDDING_CONFIG.dimensions;

  constructor(
    private readonly mockFn?: (options: CreateEmbeddingsOptions) => Promise<EmbeddingResult>,
  ) {}

  async generateEmbeddings(options: CreateEmbeddingsOptions): Promise<EmbeddingResult> {
    if (this.mockFn) {
      return this.mockFn(options);
    }
    const inputs = Array.isArray(options.input) ? options.input : [options.input];
    const dimensions = options.dimensions ?? EMBEDDING_CONFIG.dimensions;
    return {
      embeddings: inputs.map(() => Array.from({ length: dimensions }, () => 0)),
      model: options.model ?? "mock-embedding-model",
      dimensions,
    };
  }
}

export * from "./geminiEmbeddingProvider";
export * from "./cloudflareEmbeddingProvider";
export * from "./router";

