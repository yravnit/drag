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

    // Detach and the "is anyone left?" decision happen in one transaction behind a row lock on the
    // repository. Counting first and deleting afterwards left a window in which another user could
    // attach the repository; the cascading deletes then took that new association, its index, and
    // its conversations with it. `POST /api/repos` takes the same lock before inserting an
    // association, so the two cannot interleave.
    const associationCount = await db.transaction(async (tx) => {
      await tx
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, repoId))
        .for("update");

      // 1. Remove association for this user
      await tx
        .delete(userRepositories)
        .where(and(eq(userRepositories.userId, userId), eq(userRepositories.repositoryId, repoId)));

      // 2. Remove conversations belonging to this user for this repository
      // Cascades to messages via messages.conversation_id foreign key
      await tx
        .delete(conversations)
        .where(and(eq(conversations.userId, userId), eq(conversations.repositoryId, repoId)));

      // 3. Recheck the count while holding the lock, before any cascade can fire.
      const [result] = await tx
        .select({ value: count() })
        .from(userRepositories)
        .where(eq(userRepositories.repositoryId, repoId));

      const remaining = Number(result?.value ?? 0);

      if (remaining === 0) {
        // No users associated anymore — delete repository completely.
        // Cascade removes chunks and repositoryFiles automatically.
        await tx.delete(repositories).where(eq(repositories.id, repoId));
      }

      return remaining;
    });

    // 4. Invalidate access cache for this user and repository
    await invalidateRepositoryAccessCache(db, userId, repoId);

    return NextResponse.json({ success: true, deleted: associationCount === 0 });
  } catch (error) {
    console.error("[DELETE /api/repos/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to remove repository" }, { status: 500 });
  }
}
