import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/db";
import { repositoryAccessCache, userRepositories } from "@/db/schema";
import { GitHubApiClient } from "@/lib/ingestion/githubApiClient";

export interface VerifyAccessParams {
  userId: string;
  repositoryId: string;
  owner: string;
  name: string;
}

export interface VerifyAccessOptions {
  // Route adapters supply this because fetching the Better Auth OAuth token needs request headers
  getGithubToken: () => Promise<string | null | undefined>;
  // Test seam; defaults to (token) => new GitHubApiClient({ authToken: token })
  createGithubClient?: (token: string) => {
    getRepository(owner: string, name: string): Promise<unknown>;
  };
  cacheTtlMs?: number; // default 60 * 60 * 1000
}

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

export async function verifyRepositoryAccess(
  database: Database,
  params: VerifyAccessParams,
  options: VerifyAccessOptions,
): Promise<{ hasAccess: boolean }> {
  const { userId, repositoryId, owner, name } = params;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - ttl);

  const [cached] = await database
    .select()
    .from(repositoryAccessCache)
    .where(
      and(
        eq(repositoryAccessCache.userId, userId),
        eq(repositoryAccessCache.repositoryId, repositoryId),
      ),
    )
    .limit(1);

  if (cached && cached.verifiedAt > oneHourAgo) {
    return { hasAccess: cached.hasAccess };
  }

  // Re-verify access using GitHub API and user token
  let hasAccess: boolean;
  const userToken = await options.getGithubToken();

  if (!userToken) {
    hasAccess = false;
  } else {
    const createClient =
      options.createGithubClient ??
      ((token: string) => new GitHubApiClient({ authToken: token }));
    const client = createClient(userToken);
    try {
      await client.getRepository(owner, name);
      hasAccess = true;
    } catch {
      hasAccess = false;
    }
  }

  // Upsert access cache entry
  await database
    .insert(repositoryAccessCache)
    .values({
      userId,
      repositoryId,
      hasAccess,
      verifiedAt: now,
    })
    .onConflictDoUpdate({
      target: [repositoryAccessCache.userId, repositoryAccessCache.repositoryId],
      set: {
        hasAccess,
        verifiedAt: now,
      },
    });

  return { hasAccess };
}

export async function assertRepositoryAssociation(
  database: Database,
  userId: string,
  repositoryId: string,
): Promise<boolean> {
  const [association] = await database
    .select()
    .from(userRepositories)
    .where(
      and(eq(userRepositories.userId, userId), eq(userRepositories.repositoryId, repositoryId))
    )
    .limit(1);

  return Boolean(association);
}

export async function invalidateRepositoryAccessCache(
  database: Database,
  userId: string,
  repositoryId?: string,
): Promise<void> {
  if (repositoryId) {
    await database
      .delete(repositoryAccessCache)
      .where(
        and(
          eq(repositoryAccessCache.userId, userId),
          eq(repositoryAccessCache.repositoryId, repositoryId),
        ),
      );
  } else {
    await database
      .delete(repositoryAccessCache)
      .where(eq(repositoryAccessCache.userId, userId));
  }
}

