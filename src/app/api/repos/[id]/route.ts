import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { repositories, userRepositories, conversations } from "@/db/schema";
import { and, eq, count } from "drizzle-orm";
import { invalidateRepositoryAccessCache } from "@/lib/access/repositoryAccess";

export async function DELETE(
  request: Request,
  // Next.js 16 requires dynamic params to be async (awaited)
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const { id: repoId } = params;

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 1. Remove association for this user
    await db
      .delete(userRepositories)
      .where(and(eq(userRepositories.userId, userId), eq(userRepositories.repositoryId, repoId)));

    // 2. Remove conversations belonging to this user for this repository
    // Cascades to messages via messages.conversation_id foreign key
    await db
      .delete(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.repositoryId, repoId)));

    // 3. Invalidate access cache for this user and repository
    await invalidateRepositoryAccessCache(db, userId, repoId);

    // 2. Check if any other user is still associated with this repository
    const [result] = await db
      .select({ value: count() })
      .from(userRepositories)
      .where(eq(userRepositories.repositoryId, repoId));

    const associationCount = result?.value ?? 0;

    if (associationCount === 0) {
      // No users associated anymore — delete repository completely
      // Cascade will delete chunks and repositoryFiles automatically
      await db.delete(repositories).where(eq(repositories.id, repoId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/repos/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to remove repository" }, { status: 500 });
  }
}
