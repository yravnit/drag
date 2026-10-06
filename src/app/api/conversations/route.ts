import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { conversations } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { assertRepositoryAssociation } from "@/lib/access/repositoryAccess";

/**
 * GET /api/conversations?repositoryId=xxx
 * Lists all conversations for the given repository associated with the authenticated user.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const repositoryId = searchParams.get("repositoryId");

    if (!repositoryId) {
      return NextResponse.json({ error: "Missing repositoryId parameter" }, { status: 400 });
    }

    const list = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, session.user.id), eq(conversations.repositoryId, repositoryId)))
      .orderBy(desc(conversations.createdAt));

    return NextResponse.json(list);
  } catch (error) {
    console.error("[GET /api/conversations] Error:", error);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }
}

/**
 * POST /api/conversations
 * Creates a new conversation thread.
 * Body: { repositoryId: string, title?: string }
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    const { repositoryId, title } = body as { repositoryId?: string; title?: string };
    if (!repositoryId) {
      return NextResponse.json({ error: "Missing repositoryId" }, { status: 400 });
    }

    // Verify user is associated with this repository
    const associated = await assertRepositoryAssociation(db, session.user.id, repositoryId);

    if (!associated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const finalTitle = title?.trim() || "New Chat Thread";

    const [conv] = await db
      .insert(conversations)
      .values({
        userId: session.user.id,
        repositoryId,
        title: finalTitle,
      })
      .returning();

    return NextResponse.json({
      success: true,
      conversationId: conv.id,
      title: conv.title,
    });
  } catch (error) {
    console.error("[POST /api/conversations] Error:", error);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }
}
