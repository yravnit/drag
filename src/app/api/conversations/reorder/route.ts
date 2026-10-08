import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { conversations } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PATCH /api/conversations/reorder
 * Persists the authenticated user's drag-and-drop order for one repository's thread list.
 * Body: { repositoryId: string, orderedIds: string[] } — conversation ids, first = top.
 *
 * A `reorder` segment is a static route, and Next.js 16 checks static matchers before dynamic ones
 * (`DefaultRouteMatcherManager.matchAll`), so this resolves here and never to `[id]`.
 *
 * Every write is filtered on the caller's `userId` **and** the given `repositoryId`, so a foreign
 * conversation id matches nothing and is silently ignored rather than mutating somebody else's
 * order — and a thread cannot be dragged between repositories by a forged payload.
 */
export async function PATCH(request: Request) {
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

    const { repositoryId, orderedIds } = body as { repositoryId?: unknown; orderedIds?: unknown };
    if (typeof repositoryId !== "string" || !repositoryId.trim()) {
      return NextResponse.json({ error: "Missing repositoryId" }, { status: 400 });
    }

    if (
      !Array.isArray(orderedIds) ||
      orderedIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      return NextResponse.json(
        { error: "orderedIds must be an array of conversation ids" },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      for (const [index, conversationId] of orderedIds.entries()) {
        await tx
          .update(conversations)
          .set({ sortOrder: index })
          .where(
            and(
              eq(conversations.userId, session.user.id),
              eq(conversations.repositoryId, repositoryId),
              eq(conversations.id, conversationId),
            ),
          );
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PATCH /api/conversations/reorder] Error:", error);
    return NextResponse.json({ error: "Failed to reorder conversations" }, { status: 500 });
  }
}