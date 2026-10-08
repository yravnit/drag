import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { userRepositories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PATCH /api/repos/reorder
 * Persists the authenticated user's drag-and-drop order for their repository list.
 * Body: { orderedIds: string[] } — repository ids, first = top of the list.
 *
 * Every write is filtered on the caller's own `userId`, so an id belonging to another user (or to
 * a repository the caller has since detached) matches nothing and is silently ignored rather than
 * mutating somebody else's order.
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

    const { orderedIds } = body as { orderedIds?: unknown };
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      return NextResponse.json(
        { error: "orderedIds must be an array of repository ids" },
        { status: 400 },
      );
    }

    // The whole order is written in one transaction: a partially applied reorder would leave the
    // list in an order the user never asked for.
    await db.transaction(async (tx) => {
      for (const [index, repositoryId] of orderedIds.entries()) {
        await tx
          .update(userRepositories)
          .set({ sortOrder: index })
          .where(
            and(
              eq(userRepositories.userId, session.user.id),
              eq(userRepositories.repositoryId, repositoryId),
            ),
          );
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PATCH /api/repos/reorder] Error:", error);
    return NextResponse.json({ error: "Failed to reorder repositories" }, { status: 500 });
  }
}