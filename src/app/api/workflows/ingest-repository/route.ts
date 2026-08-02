import { start } from "workflow/api";
import { ingestRepository } from "@/workflows/ingest";
import { NextResponse } from "next/server";

export interface IngestPayload {
  owner: string;
  repo: string;
  authToken?: string;
  revision?: string;
  batchSize?: number;
  extraIgnorePatterns?: string[];
}

/**
 * POST /api/workflows/ingest-repository
 *
 * Triggers the repository ingestion workflow.
 * Payload: { owner, repo, authToken?, revision?, batchSize?, extraIgnorePatterns? }
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

    const run = await start(ingestRepository, [body]);

    return NextResponse.json({
      message: "Ingestion workflow started",
      runId: run.runId,
      owner: body.owner,
      repo: body.repo,
    });
  } catch (error) {
    console.error("[API Error] Ingestion route failed:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to start ingestion workflow" },
      { status: 500 },
    );
  }
}
