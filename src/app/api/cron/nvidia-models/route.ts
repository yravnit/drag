import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/cronAuth";
import { db } from "@/db/db";
import { serverEnv } from "@/data/serverEnv";
import { refreshNvidiaModels } from "@/lib/nvidia/nvidiaModelService";

/**
 * GET /api/cron/nvidia-models
 *
 * Weekly Vercel Cron trigger to discover and probe NVIDIA chat models.
 * Protected by Vercel Cron bearer token authentication.
 */
export async function GET(request: Request) {
  // Reject unauthorized callers in production
  if (process.env.NODE_ENV === "production" && !isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // When CRON_SECRET is defined in any environment, fail closed on missing/invalid token
  if (process.env.CRON_SECRET && !isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await refreshNvidiaModels(db, serverEnv.NVIDIA_API_KEY);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Cron NVIDIA Models] Weekly refresh failed:", error);
    return NextResponse.json(
      { error: "Failed to refresh NVIDIA models" },
      { status: 500 },
    );
  }
}
