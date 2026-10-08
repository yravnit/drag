import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { conversations } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PATCH /api/conversations/[id]
 * Renames a conversation thread belonging to the authenticated user.
 */
export async function PATCH(
  request: Request,
  // Next.js 16 requires dynamic params to be async (awaited)
  props: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    const { id: conversationId } = params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    const { title } = body as { title?: unknown };
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Title must be a non-empty string" }, { status: 400 });
    }

    if (title.length > 100) {
      return NextResponse.json(
        { error: "Title cannot exceed 100 characters" },
        { status: 400 },
      );
    }

    // Verify ownership before updating
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(conversations)
      .set({
        title: title.trim(),
        updatedAt: new Date(),
      })
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
      .returning();

    return NextResponse.json({
      success: true,
      id: updated.id,
      title: updated.title,
    });
  } catch (error) {
    console.error("[PATCH /api/conversations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}

/**
 * DELETE /api/conversations/[id]
 * Deletes a conversation thread belonging to the authenticated user.
 */
export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    const { id: conversationId } = params;

    // Verify ownership before deleting
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    await db
      .delete(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/conversations/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
