import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { repositories, repositoryFiles, chunks } from "@/db/schema";
import { eq, count, sql, and, isNotNull, isNull } from "drizzle-orm";
import { assertRepositoryAssociation } from "@/lib/access/repositoryAccess";

export async function GET(
  request: Request,
  // Next.js 16 requires dynamic params to be async (awaited)
  props: { params: Promise<{ id: string }> },
) {
  try {
    const params = await props.params;
    const { id: repoId } = params;

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user association before showing status
    const associated = await assertRepositoryAssociation(db, session.user.id, repoId);

    if (!associated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [repo] = await db
      .select({
        id: repositories.id,
        embeddingStatus: repositories.embeddingStatus,
        indexedAt: repositories.indexedAt,
        defaultBranch: repositories.defaultBranch,
        primaryLanguage: repositories.primaryLanguage,
        headCommitSha: repositories.headCommitSha,
        syncStatus: repositories.syncStatus,
        isPrivate: repositories.isPrivate,
        embeddingProvider: repositories.embeddingProvider,
        embeddingModel: repositories.embeddingModel,
        updatedAt: repositories.updatedAt,
        embeddingLeaseExpiresAt: repositories.embeddingLeaseExpiresAt,
        embeddingClaimId: repositories.embeddingClaimId,
      })
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);

    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    // Query file-level indexing metrics and aggregate storage size
    let filesIndexed = 0;
    let chunksCount = 0;
    let embeddedChunksCount = 0;
    let totalSizeBytes: number | null = null;
    try {
      const [filesRes] = await db
        .select({
          count: count(),
          totalSizeBytes: sql<string>`coalesce(sum(cast(${repositoryFiles.sizeBytes} as bigint)), 0)::text`,
        })
        .from(repositoryFiles)
        .where(eq(repositoryFiles.repositoryId, repoId));
      if (filesRes) {
        filesIndexed = Number(filesRes.count) || 0;
        if (filesRes.totalSizeBytes !== undefined && filesRes.totalSizeBytes !== null) {
          const parsed = Number(filesRes.totalSizeBytes);
          totalSizeBytes = Number.isFinite(parsed) ? parsed : null;
        }
      }

      const [chunksRes] = await db
        .select({ count: count() })
        .from(chunks)
        .where(eq(chunks.repositoryId, repoId));
      if (chunksRes) {
        chunksCount = Number(chunksRes.count) || 0;
      }

      const [embeddedRes] = await db
        .select({ count: count() })
        .from(chunks)
        .where(and(eq(chunks.repositoryId, repoId), isNotNull(chunks.embedding)));
      if (embeddedRes) {
        embeddedChunksCount = Number(embeddedRes.count) || 0;
      }
    } catch {
      // Graceful fallback if testing without mock repository_files/chunks table
    }

    const now = new Date();
    const STALE_INGEST_MS = 15 * 60 * 1000;
    const isLeaseExpired = repo.embeddingLeaseExpiresAt
      ? repo.embeddingLeaseExpiresAt.getTime() < now.getTime()
      : false;
    // `updatedAt` only indicates staleness when no lease exists. When a lease exists, only an
    // expired lease makes a processing repository stale.
    const isUpdateStale = !repo.embeddingLeaseExpiresAt && repo.updatedAt
      ? now.getTime() - repo.updatedAt.getTime() > STALE_INGEST_MS
      : false;
    // An ingestion-owned signal (claim id or active/expired lease) must exist before a stale
    // or expired timestamp can turn an active repository into a failure. A bare `updatedAt`
    // is not proof that ingestion ever owned the row.
    const hasIngestionSignal = Boolean(repo.embeddingClaimId) || Boolean(repo.embeddingLeaseExpiresAt);

    let rawStatus = repo.embeddingStatus || "processing";
    let isStale = false;

    if (
      rawStatus === "processing" &&
      (isLeaseExpired || isUpdateStale) &&
      hasIngestionSignal
    ) {
      try {
        if (db.update) {
          const updateQuery = db
            .update(repositories)
            .set({
              embeddingStatus: "failed",
              embeddingLeaseExpiresAt: null,
              embeddingClaimId: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(repositories.id, repoId),
                eq(repositories.embeddingStatus, "processing"),
                repo.embeddingClaimId
                  ? eq(repositories.embeddingClaimId, repo.embeddingClaimId)
                  : isNull(repositories.embeddingClaimId),
                repo.embeddingLeaseExpiresAt
                  ? eq(repositories.embeddingLeaseExpiresAt, repo.embeddingLeaseExpiresAt)
                  : isNull(repositories.embeddingLeaseExpiresAt),
                repo.updatedAt
                  ? eq(repositories.updatedAt, repo.updatedAt)
                  : isNull(repositories.updatedAt),
              ),
            );

          const updatedResult =
            typeof updateQuery.returning === "function"
              ? await updateQuery.returning({ id: repositories.id })
              : await updateQuery;

          const matchedRows = Array.isArray(updatedResult)
            ? updatedResult.length
            : typeof updatedResult?.rowCount === "number"
              ? updatedResult.rowCount
              : 0;

          // A concurrent completion or new claim makes the conditional update affect zero rows,
          // which preserves that newer state instead of clobbering it.
          if (matchedRows > 0) {
            rawStatus = "failed";
            isStale = true;
          }
        } else {
          rawStatus = "failed";
          isStale = true;
        }
      } catch (err) {
        console.error("Failed to mark stale repository as failed:", err);
      }
    }

    let stage: "preparing" | "indexing" | "embedding" | "ready" | "failed";
    if (rawStatus === "failed") {
      stage = "failed";
    } else if (rawStatus === "ready") {
      stage = "ready";
    } else if (filesIndexed === 0 && chunksCount === 0) {
      stage = "preparing";
    } else if (chunksCount === 0) {
      stage = "indexing";
    } else {
      stage = "embedding";
    }

    const isPrivate = Boolean(repo.isPrivate);
    const privacyLabel = isPrivate ? "Private repo" : "Public repo";
    const embeddingLabel = isPrivate ? "Protected embeddings" : "Embeddings ready";
    const privacyDisclosure = isPrivate
      ? "Private repo chats don't expose your code to public-repository AI providers."
      : "Public repository code may be used by third-party services to improve their products.";

    return NextResponse.json({
      id: repo.id,
      embeddingStatus: rawStatus,
      stage,
      isStale,
      indexedAt: repo.indexedAt,
      defaultBranch: repo.defaultBranch,
      primaryLanguage: repo.primaryLanguage,
      headCommitSha: repo.headCommitSha,
      syncStatus: repo.syncStatus,
      isPrivate,
      privacyLabel,
      embeddingLabel,
      privacyDisclosure,
      embeddingProvider: repo.embeddingProvider,
      embeddingModel: repo.embeddingModel,
      filesIndexed,
      chunksCount,
      embeddedChunksCount,
      totalSizeBytes,
    });
  } catch (error) {
    console.error("[GET /api/repos/[id]/status] Error:", error);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}
