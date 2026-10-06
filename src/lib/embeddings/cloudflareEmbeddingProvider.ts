import { serverEnv } from "@/data/serverEnv";
import {
  CreateEmbeddingsOptions,
  EmbeddingProvider,
  EmbeddingResult,
} from "./embeddingProvider";

export const CLOUDFLARE_EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const CLOUDFLARE_EMBEDDING_DIMENSIONS = 768;
const CLOUDFLARE_MAX_BATCH_SIZE = 50;

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export class CloudflareEmbeddingProvider implements EmbeddingProvider {
  public readonly name = "cloudflare";
  public readonly model = CLOUDFLARE_EMBEDDING_MODEL;
  public readonly dimensions = CLOUDFLARE_EMBEDDING_DIMENSIONS;

  constructor(
    private readonly apiToken?: string,
    private readonly accountId?: string,
  ) {}

  private getCredentials(): { apiToken: string; accountId: string } {
    const apiToken = this.apiToken ?? serverEnv.CLOUDFLARE_API_TOKEN;
    const accountId = this.accountId ?? serverEnv.CLOUDFLARE_ACCOUNT_ID;

    if (!apiToken || apiToken.trim() === "") {
      throw new Error(
        "CLOUDFLARE_API_TOKEN environment variable is missing. Set CLOUDFLARE_API_TOKEN to generate embeddings for private repositories.",
      );
    }
    if (!accountId || accountId.trim() === "") {
      throw new Error(
        "CLOUDFLARE_ACCOUNT_ID environment variable is missing. Set CLOUDFLARE_ACCOUNT_ID to generate embeddings for private repositories.",
      );
    }

    return { apiToken, accountId };
  }

  async generateEmbeddings(options: CreateEmbeddingsOptions): Promise<EmbeddingResult> {
    const { apiToken, accountId } = this.getCredentials();
    const model = options.model ?? CLOUDFLARE_EMBEDDING_MODEL;
    const targetDimensions = options.dimensions ?? CLOUDFLARE_EMBEDDING_DIMENSIONS;
    const inputList = Array.isArray(options.input) ? options.input : [options.input];

    if (inputList.length === 0) {
      return {
        embeddings: [],
        model,
        dimensions: targetDimensions,
      };
    }

    const allEmbeddings: number[][] = [];

    // Cloudflare Workers AI processes text arrays. Batch in chunks of 50.
    for (let i = 0; i < inputList.length; i += CLOUDFLARE_MAX_BATCH_SIZE) {
      const slice = inputList.slice(i, i + CLOUDFLARE_MAX_BATCH_SIZE);

      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: slice,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Cloudflare Workers AI embedding API failed with HTTP ${response.status}: ${errorText}`,
        );
      }

      const json = (await response.json()) as {
        success?: boolean;
        errors?: Array<{ message: string }>;
        result?: {
          data?: number[][];
        };
      };

      if (!json.success || !json.result?.data) {
        const errorMsg =
          json.errors?.map((e) => e.message).join(", ") || "Unknown Cloudflare AI error";
        throw new Error(`Cloudflare Workers AI embedding generation failed: ${errorMsg}`);
      }

      const batchVectors = json.result.data;
      if (batchVectors.length !== slice.length) {
        throw new Error(
          `Cloudflare Workers AI returned ${batchVectors.length} vectors, expected ${slice.length}`,
        );
      }

      for (const rawVector of batchVectors) {
        if (rawVector.length < targetDimensions) {
          throw new Error(
            `Cloudflare Workers AI returned a ${rawVector.length}-dimension vector, expected at least ${targetDimensions}. Matryoshka truncation can only reduce dimensions.`,
          );
        }
        // Matryoshka dimension truncation & L2 normalization to match the target 768 dimensions
        const truncated =
          rawVector.length > targetDimensions
            ? rawVector.slice(0, targetDimensions)
            : rawVector;
        allEmbeddings.push(l2Normalize(truncated));
      }
    }

    return {
      embeddings: allEmbeddings,
      model,
      dimensions: targetDimensions,
    };
  }
}
