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
