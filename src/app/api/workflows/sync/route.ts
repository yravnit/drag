import { start } from "workflow/api";
import { syncRepositories, SyncPayload } from "@/workflows/sync";
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/cronAuth";

/**
 * POST /api/workflows/sync
 *
 * Triggers the sync workflow to check repositories for updates.
 * Restricted to internal callers / cron jobs via Authorization bearer token.
 * Payload: { batchSize?: number }
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as SyncPayload;

    const run = await start(syncRepositories, [body]);

    return NextResponse.json({
      message: "Sync workflow started",
      runId: run.runId,
    });
  } catch (error) {
    console.error("[API Error] Sync route failed:", error);
    return NextResponse.json({ error: "Failed to start sync workflow" }, { status: 500 });
  }
}
