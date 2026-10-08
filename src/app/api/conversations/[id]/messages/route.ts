import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { conversations, messages } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";

/**
 * GET /api/conversations/[id]/messages
 * Fetches all messages belonging to a conversation.
 */
export async function GET(
  request: Request,
  // Next.js 16 requires dynamic params to be async (awaited)
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const { id: conversationId } = params;

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Verify conversation belongs to user
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const list = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json(list);
  } catch (error) {
    console.error("[GET /api/conversations/[id]/messages] Error:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * PATCH /api/conversations/[id]/messages
 * Updates the content of a user message.
 */
export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const params = await props.params;
    const { id: conversationId } = params;

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Verify conversation belongs to user
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      messageId?: unknown;
      content?: unknown;
    } | null;

    if (!body || typeof body.messageId !== "string" || typeof body.content !== "string") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { messageId, content } = body;
    const trimmed = content.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
    }

    const [updated] = await db
      .update(messages)
      .set({ content: trimmed })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          eq(messages.role, "user"),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Message not found or cannot be edited" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/conversations/[id]/messages] Error:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
