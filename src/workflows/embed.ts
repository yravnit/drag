import { db, Database } from "@/db/db";
import { chunks, repositories } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { getEmbeddingProviderForRepository } from "@/lib/embeddings/router";

export interface EmbedPayload {
  repositoryId: string;
}

export interface EmbedResult {
  success: boolean;
  totalEmbedded: number;
}

const EMBED_BATCH_SIZE = 250;

/**
 * Maximum number of embed batches per workflow run to prevent infinite loops.
 * At 250 chunks per batch, this allows embedding up to 25,000 chunks in one run.
 * The cron job will re-trigger on the next cycle for any remaining chunks.
 */
const MAX_BATCHES_PER_RUN = 100;

/**
 * Maximum characters for a single chunk text sent to the embedding API.
 * Chunks exceeding this are truncated with "END" mode (NVIDIA NIM supported).
 */
const MAX_CHUNK_CHARS = 8192;

export async function runEmbedBatch(
  database: Database,
  repositoryId: string,
): Promise<{
  embeddedCount: number;
  hasMore: boolean;
}> {
  // Fetch chunks without embeddings
  const batchChunks = await database
    .select({
      id: chunks.id,
      text: chunks.text,
    })
    .from(chunks)
    .where(and(eq(chunks.repositoryId, repositoryId), isNull(chunks.embedding)))
    .limit(EMBED_BATCH_SIZE);

  if (batchChunks.length === 0) {
    return {
      embeddedCount: 0,
      hasMore: false,
    };
  }

  // Resolve repository visibility and embedding provider provenance
  const [repo] = await database
    .select({
      isPrivate: repositories.isPrivate,
      embeddingProvider: repositories.embeddingProvider,
      embeddingModel: repositories.embeddingModel,
      embeddingDimensions: repositories.embeddingDimensions,
    })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);

  const provider = getEmbeddingProviderForRepository({
    isPrivate: Boolean(repo?.isPrivate),
    embeddingProvider: repo?.embeddingProvider,
    embeddingModel: repo?.embeddingModel,
    embeddingDimensions: repo?.embeddingDimensions,
  });

  // Truncate oversized chunk texts to prevent repeatedly blocking on the same chunk.
  const texts = batchChunks.map((c) =>
    c.text.length > MAX_CHUNK_CHARS ? c.text.slice(0, MAX_CHUNK_CHARS) : c.text,
  );

  const result = await provider.generateEmbeddings({
    input: texts,
    truncate: "END",
  });
  const embeddings = result.embeddings;

  if (embeddings.length !== batchChunks.length) {
    throw new Error(
      `Mismatch between batch chunk size (${batchChunks.length}) and generated embeddings count (${embeddings.length})`,
    );
  }

  // Persist embeddings sequentially within a single transaction.
  // Promise.all over tx.update is avoided to prevent connection pool contention.
  await database.transaction(async (tx) => {
    const now = new Date();
    for (let i = 0; i < batchChunks.length; i++) {
      await tx
        .update(chunks)
        .set({
          embedding: embeddings[i],
          embeddingProvider: provider.name,
          embeddingModel: provider.model,
          updatedAt: now,
        })
        .where(eq(chunks.id, batchChunks[i].id));
    }

    // Persist provider and model provenance on repository record
    await tx
      .update(repositories)
      .set({
        embeddingProvider: provider.name,
        embeddingModel: provider.model,
        embeddingDimensions: provider.dimensions,
        updatedAt: now,
      })
      .where(eq(repositories.id, repositoryId));
  });

  return {
    embeddedCount: batchChunks.length,
    hasMore: batchChunks.length === EMBED_BATCH_SIZE,
  };
}

async function runEmbedBatchStep(repositoryId: string) {
  "use step";
  return runEmbedBatch(db, repositoryId);
}

import {
  claimEmbeddingLease,
  finalizeEmbedding,
  clearEmbeddingLease,
} from "@/lib/leases/repositoryLeases";

async function claimEmbeddingLeaseStep(repositoryId: string) {
  "use step";
  return claimEmbeddingLease(db, repositoryId);
}

async function clearEmbeddingLeaseStep(repositoryId: string) {
  "use step";
  return clearEmbeddingLease(db, repositoryId);
}

async function finalizeEmbeddingStep(repositoryId: string, status: "ready" | "failed") {
  "use step";
  return finalizeEmbedding(db, repositoryId, status);
}

export async function embedRepository(payload: EmbedPayload): Promise<EmbedResult> {
  "use workflow";

  if (!payload.repositoryId) {
    throw new Error('Missing required field: "repositoryId"');
  }

  const claim = await claimEmbeddingLeaseStep(payload.repositoryId);
  if (!claim.claimed) {
    return {
      success: true,
      totalEmbedded: 0,
    };
  }

  let totalEmbedded = 0;
  let hasMore = true;
  let batchCount = 0;

  try {
    while (hasMore && batchCount < MAX_BATCHES_PER_RUN) {
      const stepResult = await runEmbedBatchStep(payload.repositoryId);
      totalEmbedded += stepResult.embeddedCount;
      hasMore = stepResult.hasMore;
      batchCount++;
    }

    if (hasMore) {
      // More chunks remain: release lease so next cron cycle continues, do NOT mark ready
      await clearEmbeddingLeaseStep(payload.repositoryId);
    } else {
      await finalizeEmbeddingStep(payload.repositoryId, "ready");
    }

    return {
      success: true,
      totalEmbedded,
    };
  } catch (error) {
    await finalizeEmbeddingStep(payload.repositoryId, "failed");
    throw error;
  }
}
