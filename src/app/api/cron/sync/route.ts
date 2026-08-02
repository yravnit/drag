import { start } from "workflow/api";
import { db } from "@/db/db";
import { repositories } from "@/db/schema";
import { ingestRepository } from "@/workflows/ingest";
import { GitHubApiClient } from "@/lib/ingestion/githubApiClient";
import { serverEnv } from "@/data/serverEnv";
import { NextResponse } from "next/server";

/**
 * GET /api/cron/sync
 *
 * Vercel Cron Job entry point to check for updates on all tracked repositories.
 * Runs on a schedule configured in vercel.json.
 * For each repository:
 *   1. Fetches the latest HEAD commit SHA from GitHub.
 *   2. Compares it with the stored headCommitSha in the database.
 *   3. If the SHA has changed, triggers the ingestRepository workflow which
 *      performs incremental hash diffing to re-index only modified/added files.
 */
export async function GET(request: Request) {
  // Verify Vercel Cron authorization header in production
  if (process.env.NODE_ENV === "production") {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    // 1. Retrieve all repositories currently tracked in the database
    const trackedRepos = await db.select().from(repositories);

    if (trackedRepos.length === 0) {
      return NextResponse.json({
        message: "No repositories tracked in the database",
        triggered: [],
      });
    }

    const triggered: Array<{
      owner: string;
      repo: string;
      previousSha: string | null;
      newSha: string;
      runId: string;
    }> = [];
    const skipped: Array<{ owner: string; repo: string; sha: string | null }> = [];
    const errors: Array<{ owner: string; repo: string; error: string }> = [];

    // Use default GITHUB_TOKEN if available to avoid rate limits
    const apiClient = new GitHubApiClient({ authToken: serverEnv.GITHUB_TOKEN });

    // 2. Iterate through each repo, check for updates, and trigger ingestion if SHA changed
    for (const repo of trackedRepos) {
      try {
        const latestCommit = await apiClient.getCommit(
          repo.owner,
          repo.name,
          repo.defaultBranch || "main",
        );
        const latestSha = latestCommit.sha;

        if (!latestSha) {
          errors.push({
            owner: repo.owner,
            repo: repo.name,
            error: "Failed to retrieve commit SHA from GitHub response",
          });
          continue;
        }

        if (repo.headCommitSha === latestSha) {
          skipped.push({
            owner: repo.owner,
            repo: repo.name,
            sha: repo.headCommitSha,
          });
        } else {
          // Trigger the standard ingestion workflow (uses incremental diffing)
          const run = await start(ingestRepository, [
            {
              owner: repo.owner,
              repo: repo.name,
              revision: repo.defaultBranch,
            },
          ]);

          triggered.push({
            owner: repo.owner,
            repo: repo.name,
            previousSha: repo.headCommitSha,
            newSha: latestSha,
            runId: run.runId,
          });
        }
      } catch (error) {
        console.error(`[Cron Sync] Error checking repository ${repo.owner}/${repo.name}:`, error);
        errors.push({
          owner: repo.owner,
          repo: repo.name,
          error: (error as Error).message || "Unknown error",
        });
      }
    }

    return NextResponse.json({
      message: `Checked ${trackedRepos.length} repositories`,
      triggeredCount: triggered.length,
      skippedCount: skipped.length,
      errorsCount: errors.length,
      triggered,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("[Cron Sync Error] General failure running cron sync:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to run cron sync" },
      { status: 500 },
    );
  }
}
