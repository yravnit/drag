import { start } from "workflow/api";
import { isCronAuthorized } from "@/lib/cron/cronAuth";
import { NextResponse } from "next/server";
import { syncRepositories } from "@/workflows/sync";

export async function GET(request: Request) {
  // Verify Vercel Cron authorization header in production
  if (process.env.NODE_ENV === "production" && !isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { runId } = await start(syncRepositories, [{}]);
    
    return NextResponse.json({
      message: "Sync workflow triggered",
      runId,
    });
  } catch (error) {
    console.error("[Cron Sync Error] General failure running cron sync:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to trigger cron sync" },
      { status: 500 },
    );
  }
}
