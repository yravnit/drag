import { Database } from "@/db/db";
import { chunks, repositories } from "@/db/schema";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";

const LEASE_DURATION_MS = 10 * 60 * 1000;

export async function claimEmbeddingLease(database: Database, repositoryId: string) {
  return await database.transaction(async (tx) => {
    const now = new Date();
    const [repo] = await tx
      .select()
      .from(repositories)
      .where(eq(repositories.id, repositoryId))
      .for("update", { skipLocked: true });

    if (!repo) {
      return { claimed: false };
    }

    if (
      repo.embeddingStatus === "processing" &&
      repo.embeddingLeaseExpiresAt &&
      repo.embeddingLeaseExpiresAt > now
    ) {
      return { claimed: false };
    }

    const [pendingChunk] = await tx
      .select({ id: chunks.id })
      .from(chunks)
      .where(and(eq(chunks.repositoryId, repositoryId), isNull(chunks.embedding)))
      .limit(1);

    if (!pendingChunk) {
      await tx
        .update(repositories)
        .set({
          embeddingStatus: "ready",
          embeddingLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(repositories.id, repositoryId));
      return { claimed: false };
    }

    const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS);

    await tx
      .update(repositories)
      .set({
        embeddingStatus: "processing",
        embeddingLeaseExpiresAt: leaseExpiry,
        updatedAt: now,
      })
      .where(eq(repositories.id, repositoryId));

    return { claimed: true };
  });
}

export async function finalizeEmbedding(
  database: Database,
  repositoryId: string,
  status: "ready" | "failed",
) {
  await database
    .update(repositories)
    .set({
      embeddingStatus: status,
      embeddingLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));
}

export async function clearEmbeddingLease(
  database: Database,
  repositoryId: string,
) {
  await database
    .update(repositories)
    .set({
      embeddingStatus: "processing",
      embeddingLeaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));
}

export async function claimSyncBatch(database: Database, batchSize: number) {
  return await database.transaction(async (tx) => {
    const now = new Date();

    // Claim repos WHERE nextSyncAt <= now AND (syncStatus != 'processing' OR lease expired)
    const dueCondition = or(
      isNull(repositories.nextSyncAt),
      lt(repositories.nextSyncAt, now),
    );

    const leaseCondition = or(
      isNull(repositories.syncStatus),
      ne(repositories.syncStatus, "processing"),
      and(
        eq(repositories.syncStatus, "processing"),
        lt(repositories.syncLeaseExpiresAt, now),
      ),
    );

    const reposToClaim = await tx
      .select({
        id: repositories.id,
        owner: repositories.owner,
        name: repositories.name,
        defaultBranch: repositories.defaultBranch,
        headCommitSha: repositories.headCommitSha,
      })
      .from(repositories)
      .where(and(dueCondition, leaseCondition))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    if (reposToClaim.length === 0) {
      return [];
    }

    const repoIds = reposToClaim.map((r) => r.id);
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS); // 10 minutes

    await tx
      .update(repositories)
      .set({
        syncStatus: "processing",
        syncLeaseExpiresAt: leaseExpiresAt,
        updatedAt: now,
      })
      .where(inArray(repositories.id, repoIds));

    return reposToClaim;
  });
}

export async function settleSyncLease(database: Database, repositoryId: string) {
  const now = new Date();
  const nextSyncAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  await database
    .update(repositories)
    .set({
      syncStatus: "completed",
      syncLeaseExpiresAt: null,
      nextSyncAt,
      updatedAt: now,
    })
    .where(eq(repositories.id, repositoryId));
}

export async function findRepositoriesWithPendingEmbeddings(
  database: Database,
  limit: number,
): Promise<Array<{ id: string }>> {
  const now = new Date();

  return await database
    .selectDistinct({ id: repositories.id })
    .from(repositories)
    .innerJoin(chunks, eq(chunks.repositoryId, repositories.id))
    .where(
      and(
        isNull(chunks.embedding),
        or(
          isNull(repositories.embeddingStatus),
          ne(repositories.embeddingStatus, "processing"),
          isNull(repositories.embeddingLeaseExpiresAt),
          lt(repositories.embeddingLeaseExpiresAt, now),
        ),
      ),
    )
    .limit(limit);
}
