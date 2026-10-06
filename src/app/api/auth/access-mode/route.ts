import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { getUserAccessMode, GITHUB_ACCESS_SCOPES } from "@/lib/auth/accessMode";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessMode = await getUserAccessMode(db, session.user.id);
    const scopes = GITHUB_ACCESS_SCOPES[accessMode];

    return NextResponse.json({
      accessMode,
      scopes,
    });
  } catch (error) {
    console.error("[GET /api/auth/access-mode] Error:", error);
    return NextResponse.json(
      { error: "Failed to determine access mode" },
      { status: 500 },
    );
  }
}
