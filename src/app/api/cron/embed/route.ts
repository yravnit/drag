import { start } from "workflow/api";
import { db } from "@/db/db";
import { chunks, repositories } from "@/db/schema";
import { isNull, and, or, ne, lt, eq, inArray } from "drizzle-orm";
import { embedRepository } from "@/workflows/embed";
import { isCronAuthorized } from "@/lib/cron/cronAuth";
import { NextResponse } from "next/server";

/**
 * GET /api/cron/embed
 *
 * Vercel Cron Job entry point to process pending embeddings.
 * Atomically claims a bounded batch of repositories.
 */
export async function GET(request: Request) {
  // Verify Vercel Cron authorization header in production
  if (process.env.NODE_ENV === "production" && !isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const BATCH_SIZE = 5; // Keep processing bounded
    const now = new Date();
    const leaseDurationMs = 10 * 60 * 1000; // 10-minute lease
    const leaseExpiry = new Date(now.getTime() + leaseDurationMs);

    // Atomically claim a batch of repositories
    const claimedRepoIds = await db.transaction(async (tx) => {
      const eligible = await tx
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
        .limit(BATCH_SIZE)
        .for("update", { skipLocked: true });

      if (eligible.length === 0) {
        return [];
      }

      const ids = eligible.map((r) => r.id);

      await tx
        .update(repositories)
        .set({
          embeddingStatus: "processing",
          embeddingLeaseExpiresAt: leaseExpiry,
          updatedAt: now,
        })
        .where(inArray(repositories.id, ids));

      return ids;
    });

    if (claimedRepoIds.length === 0) {
      return NextResponse.json({
        message: "No pending embeddings to process",
        triggered: [],
      });
    }

    const runs: Array<{ repositoryId: string; runId: string }> = [];
    const failures: Array<{ repositoryId: string; error: string }> = [];

    // Trigger the embedRepository workflow for each repository with pending chunks.
    // A failure on one repository must not abort remaining repositories.
    for (const repoId of claimedRepoIds) {
      try {
        const run = await start(
          embedRepository,
          [{ repositoryId: repoId }],
          { runId: `embed_${repoId}` }, // Idempotency runId
        );
        runs.push({
          repositoryId: repoId,
          runId: run.runId,
        });
      } catch (error) {
        console.error(
          `[Cron Error] Failed to start embed workflow for repository ${repoId}:`,
          error,
        );
        failures.push({
          repositoryId: repoId,
          error: (error as Error).message || "Unknown error",
        });

        // Release claim immediately on failure so it can be retried by the next run
        try {
          await db
            .update(repositories)
            .set({
              embeddingStatus: "failed",
              embeddingLeaseExpiresAt: new Date(0),
              updatedAt: new Date(),
            })
            .where(eq(repositories.id, repoId));
        } catch (dbErr) {
          console.error(`[Cron Error] Failed to release claim for repository ${repoId}:`, dbErr);
        }
      }
    }

    return NextResponse.json({
      message: `Triggered embeddings workflow for ${runs.length} repositories`,
      runs,
      failures,
    });
  } catch (error) {
    console.error("[Cron Error] Failed to process cron embeddings:", error);
    return NextResponse.json({ error: "Failed to run cron embeddings" }, { status: 500 });
  }
}
