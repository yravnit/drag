import { start } from "workflow/api";
import { embedRepository, EmbedPayload } from "@/workflows/embed";
import { NextResponse } from "next/server";

/**
 * POST /api/workflows/embed
 *
 * Triggers the chunk embedding generation workflow for a specific repository.
 * Payload: { repositoryId }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EmbedPayload;

    if (!body.repositoryId) {
      return NextResponse.json(
        { error: 'Missing required field: "repositoryId"' },
        { status: 400 },
      );
    }

    const run = await start(embedRepository, [body]);

    return NextResponse.json({
      message: "Embeddings workflow started",
      runId: run.runId,
      repositoryId: body.repositoryId,
    });
  } catch (error) {
    console.error("[API Error] Embeddings route failed:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to start embeddings workflow" },
      { status: 500 },
    );
  }
}
