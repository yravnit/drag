import { start } from "workflow/api";
import { db } from "@/db/db";
import { chunks } from "@/db/schema";
import { isNull } from "drizzle-orm";
import { embedRepository } from "@/workflows/embed";
import { isCronAuthorized } from "@/lib/cron/cronAuth";
import { NextResponse } from "next/server";

/**
 * GET /api/cron/embed
 *
 * Vercel Cron Job entry point to process pending embeddings.
 * Runs on a schedule configured in vercel.json (e.g. Saturday 12:00 AM IST / Friday 18:30 UTC).
 * Finds all repositories with chunks that do not have embeddings and triggers
 * the embeddings workflow for each. Failures on individual repositories are
 * collected rather than aborting the entire run.
 */
export async function GET(request: Request) {
  // Verify Vercel Cron authorization header in production
  if (process.env.NODE_ENV === "production" && !isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Find all distinct repository IDs that have at least one chunk with a null embedding
    const pendingRepos = await db
      .selectDistinct({ repositoryId: chunks.repositoryId })
      .from(chunks)
      .where(isNull(chunks.embedding));

    if (pendingRepos.length === 0) {
      return NextResponse.json({
        message: "No pending embeddings to process",
        triggered: [],
      });
    }

    const runs: Array<{ repositoryId: string; runId: string }> = [];
    const failures: Array<{ repositoryId: string; error: string }> = [];

    // Trigger the embedRepository workflow for each repository with pending chunks.
    // A failure on one repository must not abort remaining repositories.
    for (const repo of pendingRepos) {
      if (!repo.repositoryId) continue;
      try {
        const run = await start(embedRepository, [{ repositoryId: repo.repositoryId }]);
        runs.push({
          repositoryId: repo.repositoryId,
          runId: run.runId,
        });
      } catch (error) {
        console.error(
          `[Cron Error] Failed to start embed workflow for repository ${repo.repositoryId}:`,
          error,
        );
        failures.push({
          repositoryId: repo.repositoryId,
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
