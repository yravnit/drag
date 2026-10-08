import { NextResponse } from "next/server";
import { db } from "@/db/db";
import { getPersistedNvidiaModels } from "@/lib/nvidia/nvidiaModelService";

/**
 * GET /api/nvidia-models
 *
 * Exposes currently usable NVIDIA LLMs from the PostgreSQL persistence layer.
 * Strictly reads persisted results and never triggers live model probes on request.
 */
export async function GET() {
  try {
    const data = await getPersistedNvidiaModels(db);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[GET /api/nvidia-models] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch NVIDIA models" },
      { status: 500 },
    );
  }
}
