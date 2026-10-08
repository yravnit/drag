import { EmbeddingProvider } from "./embeddingProvider";
import { GeminiEmbeddingProvider, GEMINI_EMBEDDING_MODEL } from "./geminiEmbeddingProvider";
import {
  CloudflareEmbeddingProvider,
  CLOUDFLARE_EMBEDDING_MODEL,
} from "./cloudflareEmbeddingProvider";

export const PUBLIC_REPO_PRIVACY_DISCLOSURE =
  "Public repository code may be used by third-party services to improve their products.";

export const PRIVATE_REPO_PRIVACY_DISCLOSURE =
  "Private repo chats don't expose your code to public-repository AI providers.";

export interface RepositoryEmbeddingMetadata {
  isPrivate: boolean;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
}

/**
 * Resolves the embedding provider based strictly on server-verified repository visibility.
 *
 * Invariants:
 * - Public repositories route to Google Gemini (gemini-embedding-2, 768 dims).
 * - Private repositories route to Cloudflare Workers AI (@cf/qwen/qwen3-embedding-0.6b, 768 dims).
 * - Private repository embeddings never fallback to Gemini under any circumstances.
 * - Client-supplied visibility or provider values are ignored.
 *
 * Server-verified visibility always wins over stored provenance. A stored `embeddingProvider`
 * can go stale when a public repository is flipped to private, and honouring it would ship
 * private source code to Gemini. Public repositories still honour recorded provenance so query
 * embeddings stay in the same space as the indexed chunks.
 */
export function getEmbeddingProviderForRepository(
  repo: RepositoryEmbeddingMetadata,
): EmbeddingProvider {
  if (repo.isPrivate) {
    return new CloudflareEmbeddingProvider();
  }

  // Public repository: adhere strictly to recorded provider provenance when present
  if (repo.embeddingProvider === "cloudflare") {
    return new CloudflareEmbeddingProvider();
  }

  return new GeminiEmbeddingProvider();
}

/**
 * Returns default embedding metadata to persist for a newly indexed repository.
 */
export function getDefaultEmbeddingMetadataForVisibility(isPrivate: boolean): {
  embeddingProvider: "gemini" | "cloudflare";
  embeddingModel: string;
  embeddingDimensions: number;
} {
  if (isPrivate) {
    return {
      embeddingProvider: "cloudflare",
      embeddingModel: CLOUDFLARE_EMBEDDING_MODEL,
      embeddingDimensions: 768,
    };
  }
  return {
    embeddingProvider: "gemini",
    embeddingModel: GEMINI_EMBEDDING_MODEL,
    embeddingDimensions: 768,
  };
}
