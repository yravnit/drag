import { randomUUID } from "crypto";
import { Database } from "@/db/db";
import { chunks, repositories } from "@/db/schema";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";

const LEASE_DURATION_MS = 10 * 60 * 1000;

export type EmbeddingClaim = { claimed: true; claimId: string } | { claimed: false };

/**
 * Claims the embedding lease for a repository and returns a claim id the caller must present on
 * every subsequent write. A full run's provider pacing alone can exceed the lease duration, so the
 * lease alone is not proof of ownership: without an id, a worker whose lease expired could clear
 * or overwrite the state of whichever worker claimed it next.
 */
export async function claimEmbeddingLease(
  database: Database,
  repositoryId: string,
): Promise<EmbeddingClaim> {
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
          embeddingClaimId: null,
          updatedAt: now,
        })
        .where(eq(repositories.id, repositoryId));
      return { claimed: false };
    }

    const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS);
    const claimId = randomUUID();

    await tx
      .update(repositories)
      .set({
        embeddingStatus: "processing",
        embeddingLeaseExpiresAt: leaseExpiry,
        embeddingClaimId: claimId,
        updatedAt: now,
      })
      .where(eq(repositories.id, repositoryId));

    return { claimed: true, claimId };
  });
}

/**
 * Extends the lease held by `claimId`. Returns false when the claim was lost, which is the
 * caller's signal to stop rather than keep writing on someone else's behalf.
 */
export async function renewEmbeddingLease(
  database: Database,
  repositoryId: string,
  claimId: string,
): Promise<boolean> {
  const rows = await database
    .update(repositories)
    .set({
      embeddingLeaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
      updatedAt: new Date(),
    })
    .where(
      and(eq(repositories.id, repositoryId), eq(repositories.embeddingClaimId, claimId)),
    )
    .returning({ id: repositories.id });

  return rows.length > 0;
}

/**
 * Sets the terminal embedding status. Scoped to `claimId` so a worker that lost its lease cannot
 * mark another worker's run as ready or failed.
 */
export async function finalizeEmbedding(
  database: Database,
  repositoryId: string,
  status: "ready" | "failed",
  claimId: string,
): Promise<boolean> {
  const rows = await database
    .update(repositories)
    .set({
      embeddingStatus: status,
      embeddingLeaseExpiresAt: null,
      embeddingClaimId: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(repositories.id, repositoryId), eq(repositories.embeddingClaimId, claimId)),
    )
    .returning({ id: repositories.id });

  return rows.length > 0;
}

/**
 * Releases the lease without a terminal status, so a later run continues the remaining chunks.
 * Claim-scoped for the same reason as {@link finalizeEmbedding}.
 */
export async function clearEmbeddingLease(
  database: Database,
  repositoryId: string,
  claimId?: string,
): Promise<boolean> {
  // A claim id is required for the scoped path. The unscoped variant exists only for the
  // ingestion handoff, which clears a lease it is about to hand to a fresh embed run.
  const where = claimId
    ? and(eq(repositories.id, repositoryId), eq(repositories.embeddingClaimId, claimId))
    : eq(repositories.id, repositoryId);

  const rows = await database
    .update(repositories)
    .set({
      embeddingStatus: "processing",
      embeddingLeaseExpiresAt: null,
      embeddingClaimId: null,
      updatedAt: new Date(),
    })
    .where(where)
    .returning({ id: repositories.id });

  return rows.length > 0;
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
