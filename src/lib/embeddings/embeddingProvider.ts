/**
 * Provider-agnostic embedding contract.
 *
 * Concrete providers live in sibling modules and are chosen per repository at runtime by
 * `router.ts` (`getEmbeddingProviderForRepository`): public repositories resolve to Gemini,
 * private ones to Cloudflare Workers AI. Nothing here selects a provider.
 */

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
