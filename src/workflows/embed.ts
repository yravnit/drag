import { db } from "@/db/db";
import { chunks } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { NimEmbeddingProvider } from "@/lib/embeddings/embeddingProvider";

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

async function runEmbedBatchStep(repositoryId: string): Promise<{
  embeddedCount: number;
  hasMore: boolean;
}> {
  "use step";

  // Fetch chunks without embeddings
  const batchChunks = await db
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

  // Truncate oversized chunk texts to prevent repeatedly blocking on the same chunk.
  // NVIDIA NIM also supports server-side truncation via the "END" truncate parameter.
  const texts = batchChunks.map((c) =>
    c.text.length > MAX_CHUNK_CHARS ? c.text.slice(0, MAX_CHUNK_CHARS) : c.text,
  );

  const provider = new NimEmbeddingProvider();
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
  await db.transaction(async (tx) => {
    const now = new Date();
    for (let i = 0; i < batchChunks.length; i++) {
      await tx
        .update(chunks)
        .set({
          embedding: embeddings[i],
          updatedAt: now,
        })
        .where(eq(chunks.id, batchChunks[i].id));
    }
  });

  return {
    embeddedCount: batchChunks.length,
    hasMore: batchChunks.length === EMBED_BATCH_SIZE,
  };
}

export async function embedRepository(payload: EmbedPayload): Promise<EmbedResult> {
  "use workflow";

  if (!payload.repositoryId) {
    throw new Error('Missing required field: "repositoryId"');
  }

  let totalEmbedded = 0;
  let hasMore = true;
  let batchCount = 0;

  while (hasMore && batchCount < MAX_BATCHES_PER_RUN) {
    const stepResult = await runEmbedBatchStep(payload.repositoryId);
    totalEmbedded += stepResult.embeddedCount;
    hasMore = stepResult.hasMore;
    batchCount++;
  }

  return {
    success: true,
    totalEmbedded,
  };
}
