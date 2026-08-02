import { serverEnv } from "@/data/serverEnv";

/**
 * Valid Matryoshka dimensions supported by nvidia/llama-nemotron-embed-1b-v2:
 * 384, 512, 768, 1024, 2048
 */
export const SUPPORTED_EMBEDDING_DIMENSIONS = [384, 512, 768, 1024, 2048] as const;
export type SupportedEmbeddingDimension = (typeof SUPPORTED_EMBEDDING_DIMENSIONS)[number];

export const DEFAULT_EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_EMBEDDING_MODEL = "nvidia/llama-nemotron-embed-1b-v2";
export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * Centralized Embedding Configuration
 * Reads validated environment properties from serverEnv for NVIDIA NIM API llama-nemotron-embed-1b-v2.
 */
export const EMBEDDING_CONFIG = {
  get model(): string {
    return serverEnv.EMBEDDING_MODEL;
  },
  get dimensions(): number {
    return serverEnv.EMBEDDING_DIMENSIONS;
  },
  get baseUrl(): string {
    return serverEnv.EMBEDDING_BASE_URL;
  },
  get apiKey(): string | undefined {
    return serverEnv.NVIDIA_API_KEY;
  },
  supportedDimensions: SUPPORTED_EMBEDDING_DIMENSIONS,
  DEFAULT_DIMENSIONS: DEFAULT_EMBEDDING_DIMENSIONS,
};
