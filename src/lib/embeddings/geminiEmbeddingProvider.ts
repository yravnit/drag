import { serverEnv } from "@/data/serverEnv";
import {
  CreateEmbeddingsOptions,
  EmbeddingProvider,
  EmbeddingResult,
} from "./embeddingProvider";

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
export const GEMINI_MAX_BATCH_SIZE = 25;

interface GeminiBatchEmbedResponse {
  embeddings?: Array<{ values: number[] }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
}

async function fetchWithRetry(
  endpoint: string,
  apiKey: string,
  body: string,
  maxRetries = 5,
): Promise<Response> {
  let attempt = 0;
  let baseDelayMs = 1500;

  while (attempt < maxRetries) {
    attempt++;
    const response = await fetch(endpoint, {
      method: "POST",
      // Key travels in a header, never in the URL: URLs leak into proxy and request logs.
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body,
    });

    if (response.ok) {
      return response;
    }

    const isRateLimit = response.status === 429;
    const isServerUnavailable =
      response.status === 503 ||
      response.status === 500 ||
      response.status === 502 ||
      response.status === 504;

    if (!isRateLimit && !isServerUnavailable) {
      const errorText = await response.text();
      throw new Error(
        `Google Gemini embedding API failed with HTTP ${response.status}: ${errorText}`,
      );
    }

    if (attempt >= maxRetries) {
      const errorText = await response.text();
      throw new Error(
        `Google Gemini embedding API failed after ${maxRetries} attempts with HTTP ${response.status}: ${errorText}`,
      );
    }

    let waitMs = baseDelayMs;
    try {
      const errorData = (await response.clone().json()) as GeminiBatchEmbedResponse;
      const message = errorData?.error?.message || "";
      const match = message.match(/retry in ([0-9.]+)s/i);
      if (match && match[1]) {
        waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
      } else {
        const retryInfo = errorData?.error?.details?.find(
          (d) => typeof d["@type"] === "string" && d["@type"].includes("RetryInfo"),
        ) as { retryDelay?: string } | undefined;
        if (retryInfo?.retryDelay) {
          const seconds = parseInt(retryInfo.retryDelay, 10);
          if (!isNaN(seconds)) {
            waitMs = seconds * 1000 + 1000;
          }
        }
      }
    } catch {
      // Ignore JSON parse failure on non-JSON error payloads
    }

    waitMs = Math.min(Math.max(waitMs, baseDelayMs), 35000);
    console.log(
      `[GeminiEmbeddingProvider] HTTP ${response.status} on attempt ${attempt}. Waiting ${waitMs}ms before retrying...`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    baseDelayMs = Math.min(baseDelayMs * 2, 16000);
  }

  throw new Error("Google Gemini embedding API max retries exceeded");
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly name = "gemini";
  public readonly model = GEMINI_EMBEDDING_MODEL;
  public readonly dimensions = GEMINI_EMBEDDING_DIMENSIONS;

  constructor(private readonly apiKey?: string) {}

  private getApiKey(): string {
    const key = this.apiKey ?? serverEnv.GEMINI_API_KEY;
    if (!key || key.trim() === "") {
      throw new Error(
        "GEMINI_API_KEY environment variable is missing. Set GEMINI_API_KEY to generate embeddings for public repositories.",
      );
    }
    return key;
  }

  async generateEmbeddings(options: CreateEmbeddingsOptions): Promise<EmbeddingResult> {
    const apiKey = this.getApiKey();
    const model = options.model ?? GEMINI_EMBEDDING_MODEL;
    const dimensions = options.dimensions ?? GEMINI_EMBEDDING_DIMENSIONS;
    const inputList = Array.isArray(options.input) ? options.input : [options.input];

    if (inputList.length === 0) {
      return {
        embeddings: [],
        model,
        dimensions,
      };
    }

    const taskType =
      options.inputType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";

    const allEmbeddings: number[][] = [];

    // Process in batches of up to GEMINI_MAX_BATCH_SIZE (25)
    for (let i = 0; i < inputList.length; i += GEMINI_MAX_BATCH_SIZE) {
      if (i > 0) {
        // Pacing delay between batch slices to avoid bursting against RPM quotas
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      const slice = inputList.slice(i, i + GEMINI_MAX_BATCH_SIZE);

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;

      const requestBody = JSON.stringify({
        requests: slice.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: dimensions,
        })),
      });

      const response = await fetchWithRetry(endpoint, apiKey, requestBody);

      const data = (await response.json()) as GeminiBatchEmbedResponse;

      if (!data.embeddings || data.embeddings.length !== slice.length) {
        throw new Error(
          `Google Gemini returned unexpected embedding count. Expected ${slice.length}, received ${data.embeddings?.length ?? 0}`,
        );
      }

      for (const item of data.embeddings) {
        allEmbeddings.push(item.values);
      }
    }

    return {
      embeddings: allEmbeddings,
      model,
      dimensions,
    };
  }
}
