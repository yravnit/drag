import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { getPlanUsage } from "@/lib/plans/entitlements";
import { PLAN_PRICING } from "@/lib/plans/planConfig";

/**
 * GET /api/user/plan
 *
 * Exposes current plan, pricing details, active entitlements, and usage metrics
 * for the authenticated user to support dashboard status and limit displays.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const usage = await getPlanUsage(db, session.user.id);
    const pricing = PLAN_PRICING[usage.plan];

    return NextResponse.json({
      plan: usage.plan,
      pricing,
      entitlements: usage.entitlements,
      usage: usage.usage,
    });
  } catch (error) {
    console.error("[GET /api/user/plan] Error:", error);
    return NextResponse.json({ error: "Failed to fetch plan usage" }, { status: 500 });
  }
}
