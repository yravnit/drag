import { start } from "workflow/api";
import { db } from "@/db/db";
import { findRepositoriesWithPendingEmbeddings } from "@/lib/leases/repositoryLeases";
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
    const eligible = await findRepositoriesWithPendingEmbeddings(db, BATCH_SIZE);

    if (eligible.length === 0) {
      return NextResponse.json({
        message: "No pending embeddings to process",
        triggered: [],
      });
    }

    const claimedRepoIds = eligible.map((r) => r.id);

    const runs: Array<{ repositoryId: string; runId: string }> = [];
    const failures: Array<{ repositoryId: string; error: string }> = [];

    // Trigger the embedRepository workflow for each repository with pending chunks.
    // A failure on one repository must not abort remaining repositories.
    for (const repoId of claimedRepoIds) {
      try {
        const run = await start(embedRepository, [{ repositoryId: repoId }]);
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
