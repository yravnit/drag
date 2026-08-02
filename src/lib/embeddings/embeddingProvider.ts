import OpenAI from "openai";
import { EMBEDDING_CONFIG } from "./config";

export interface CreateEmbeddingsOptions {
  input: string | string[];
  dimensions?: number;
  model?: string;
  inputType?: "passage" | "query";
  truncate?: "NONE" | "END";
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  totalTokens?: number;
}

export class NimEmbeddingProvider {
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

    try {
      const response = await client.embeddings.create({
        model,
        input: inputList,
        dimensions,
        encoding_format: "float",
        ...({
          input_type: inputType,
          truncate,
        } as any),
      });

      const embeddings = response.data.map((item) => item.embedding);

      return {
        embeddings,
        model,
        dimensions,
        totalTokens: response.usage?.total_tokens,
      };
    } catch (error: any) {
      if (error?.status === 403 || error?.statusCode === 403) {
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
