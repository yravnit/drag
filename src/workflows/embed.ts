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

  // Generate embeddings for the batch using the NimEmbeddingProvider class
  const texts = batchChunks.map((c) => c.text);
  const provider = new NimEmbeddingProvider();
  const result = await provider.generateEmbeddings({ input: texts });
  const embeddings = result.embeddings;

  if (embeddings.length !== batchChunks.length) {
    throw new Error(
      `Mismatch between batch chunk size (${batchChunks.length}) and generated embeddings count (${embeddings.length})`,
    );
  }

  // Persist the embeddings concurrently inside the transaction
  await db.transaction(async (tx) => {
    const now = new Date();
    await Promise.all(
      batchChunks.map((chunk, i) =>
        tx
          .update(chunks)
          .set({
            embedding: embeddings[i],
            updatedAt: now,
          })
          .where(eq(chunks.id, chunk.id)),
      ),
    );
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

  while (hasMore) {
    const stepResult = await runEmbedBatchStep(payload.repositoryId);
    totalEmbedded += stepResult.embeddedCount;
    hasMore = stepResult.hasMore;
  }

  return {
    success: true,
    totalEmbedded,
  };
}

embedRepository.maxConcurrency = 2;
