import { start } from "workflow/api";
import { ingestRepository, IngestPayload } from "@/workflows/ingest";
import { NextResponse } from "next/server";

/** GitHub-allowed name format: alphanumeric, hyphens, underscores, dots (no path traversal). */
const GITHUB_NAME_RE = /^[\w.-]+$/;

/**
 * POST /api/workflows/ingest-repository
 *
 * Triggers the repository ingestion workflow.
 * Payload: { owner, repo, revision?, batchSize?, extraIgnorePatterns? }
 *
 * The Vercel Workflow SDK handles durability, retries, and observability.
 * Returns human-readable JSON error responses for invalid inputs or execution failures.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IngestPayload;

    if (!body.owner || !body.repo) {
      return NextResponse.json(
        { error: 'Missing required fields: "owner" and "repo"' },
        { status: 400 },
      );
    }

    if (!GITHUB_NAME_RE.test(body.owner) || !GITHUB_NAME_RE.test(body.repo)) {
      return NextResponse.json(
        {
          error:
            'Invalid "owner" or "repo": must match GitHub name format (alphanumeric, hyphens, underscores, dots only)',
        },
        { status: 400 },
      );
    }

    const run = await start(ingestRepository, [body]);

    return NextResponse.json({
      message: "Ingestion workflow started",
      runId: run.runId,
      owner: body.owner,
      repo: body.repo,
    });
  } catch (error) {
    console.error("[API Error] Ingestion route failed:", error);
    return NextResponse.json({ error: "Failed to start ingestion workflow" }, { status: 500 });
  }
}
