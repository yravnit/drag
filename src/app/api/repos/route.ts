import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db, type Database } from "@/db/db";
import { repositories, userRepositories, chunks } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  GitHubApiClient,
  GitHubRepositoryResponse,
  GitHubTreeResponse,
} from "@/lib/ingestion/githubApiClient";
import { start } from "workflow/api";
import { ingestRepository } from "@/workflows/ingest";
import { embedRepository } from "@/workflows/embed";
import { checkRateLimit } from "@/lib/rateLimit/rateLimiter";
import { getUserAccessMode } from "@/lib/auth/accessMode";
import {
  getUserEntitlements,
  checkRepositoryLimit,
  resolveAndValidateBranch,
} from "@/lib/plans/entitlements";
import { getDefaultEmbeddingMetadataForVisibility } from "@/lib/embeddings/router";


const RATE_LIMIT_ACTION = "add-repo";
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// Helper to parse GitHub owner and repo from URL
function parseGitHubUrl(url: string): { owner: string; name: string } | null {
  try {
    const cleaned = url.trim().replace(/\/$/, "").replace(/\.git$/, "");
    const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)$/i);
    if (!match) return null;
    return { owner: match[1], name: match[2] };
  } catch {
    return null;
  }
}

/**
 * GET /api/repos
 * Lists all repositories indexed & associated with the authenticated user.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const list = await db
      .select({
        id: repositories.id,
        githubId: repositories.githubId,
        name: repositories.name,
        owner: repositories.owner,
        url: repositories.url,
        defaultBranch: repositories.defaultBranch,
        description: repositories.description,
        primaryLanguage: repositories.primaryLanguage,
        isPrivate: repositories.isPrivate,
        embeddingProvider: repositories.embeddingProvider,
        embeddingModel: repositories.embeddingModel,
        indexedAt: repositories.indexedAt,
        embeddingStatus: repositories.embeddingStatus,
        createdAt: repositories.createdAt,
      })
      .from(repositories)
      .innerJoin(userRepositories, eq(userRepositories.repositoryId, repositories.id))
      .where(eq(userRepositories.userId, session.user.id));

    // Convert BigInt id to string for JSON serialization and include server-provided privacy metadata
    const serialized = list.map((repo) => {
      const isPrivate = Boolean(repo.isPrivate);
      const privacyLabel = isPrivate ? "Private repo" : "Public repo";
      const embeddingLabel = isPrivate ? "Protected embeddings" : "Embeddings ready";
      const privacyDisclosure = isPrivate
        ? "Private repo chats don't expose your code to public-repository AI providers."
        : "Public repository code may be used by third-party services to improve their products.";

      return {
        ...repo,
        githubId: repo.githubId ? repo.githubId.toString() : null,
        privacyLabel,
        embeddingLabel,
        privacyDisclosure,
      };
    });

    return NextResponse.json(serialized);
  } catch (error) {
    console.error("[GET /api/repos] Error:", error);
    return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 500 });
  }
}

/**
 * POST /api/repos
 * Adds a new repository for indexing and associates it with the authenticated user.
 * Body: { url: string }
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Resolve active plan entitlements
    const entitlements = await getUserEntitlements(db, session.user.id);

    // Rate limiting: protect GitHub API quotas and workflow invocations
    const rateLimit = await checkRateLimit(db, {
      userId: session.user.id,
      action: RATE_LIMIT_ACTION,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Rate limit exceeded for adding repositories." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
          },
        },
      );
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

    const { url, branch } = body as { url?: unknown; branch?: unknown };
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "Missing repository URL" }, { status: 400 });
    }

    if (branch !== undefined && (typeof branch !== "string" || !branch.trim())) {
      return NextResponse.json({ error: "Invalid branch specification" }, { status: 400 });
    }

    const requestedBranch = typeof branch === "string" && branch.trim() ? branch.trim() : null;

    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid GitHub URL format" }, { status: 400 });
    }

    // Get GitHub Token
    const tokenRes = await auth.api.getAccessToken({
      body: { providerId: "github" },
      headers: request.headers,
    });
    const userToken = tokenRes?.accessToken;
    if (!userToken) {
      return NextResponse.json({ error: "No GitHub credentials found" }, { status: 403 });
    }

    const client = new GitHubApiClient({ authToken: userToken });

    // 3. Fetch metadata from GitHub
    let meta: GitHubRepositoryResponse;
    try {
      meta = await client.getRepository(parsed.owner, parsed.name);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Could not access repository on GitHub: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 404 },
      );
    }

    // 4. Verify visibility against access mode (client-provided visibility/provider is strictly ignored)
    const isPrivate = Boolean(meta.private);
    if (isPrivate) {
      const accessMode = await getUserAccessMode(db, session.user.id);
      if (accessMode === "public") {
        return NextResponse.json(
          {
            error:
              "Private repositories are not permitted in Public-only access mode. Please upgrade to Full repository access.",
          },
          { status: 403 },
        );
      }
    }

    const githubId = BigInt(meta.id);

    // 5. Verify branch policy (server enforces allowed branch based on plan entitlement)
    let targetBranch: string;
    try {
      targetBranch = resolveAndValidateBranch(entitlements, requestedBranch);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }

    let commitData;
    try {
      commitData = await client.getCommit(parsed.owner, parsed.name, targetBranch);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Branch '${targetBranch}' was not found. Only the '${entitlements.allowedBranch}' branch is supported on your plan: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      );
    }

    const treeRevision = commitData.sha;

    // 6. Perform size and file count checks via Trees API against entitlements
    let treeData: GitHubTreeResponse;
    try {
      treeData = await client.getTree(parsed.owner, parsed.name, treeRevision, true);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Failed to fetch repository tree: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 500 },
      );
    }

    if (treeData.truncated) {
      return NextResponse.json(
        { error: `Repository tree is too large (truncated by GitHub). Max allowed is ${entitlements.fileLimit} files.` },
        { status: 400 },
      );
    }

    const tree = treeData.tree || [];
    let fileCount = 0;
    let totalSizeBytes = 0;

    for (const item of tree) {
      if (item.type === "blob") {
        fileCount++;
        totalSizeBytes += item.size || 0;
      }
    }

    if (fileCount > entitlements.fileLimit) {
      return NextResponse.json(
        { error: `Repository contains too many files (${fileCount} files, max allowed: ${entitlements.fileLimit})` },
        { status: 400 },
      );
    }

    if (totalSizeBytes > entitlements.repositorySizeLimitBytes) {
      const sizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(1);
      const maxMb = (entitlements.repositorySizeLimitBytes / (1024 * 1024)).toFixed(0);
      return NextResponse.json(
        { error: `Repository exceeds size limit (${sizeMb} MB, max allowed: ${maxMb} MB)` },
        { status: 400 },
      );
    }

    // 7. Insert or check repository row
    let repoId: string | undefined;
    const [existingByGithubId] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.githubId, githubId))
      .limit(1);

    // Rows created before `github_id` existed have it null, so the github-id lookup misses them and
    // the later insert then fails on the unique URL. Fall back to the URL and backfill the id so
    // the row becomes findable by github id on every later request.
    //
    // The decision runs in a transaction that holds `FOR UPDATE` on the URL row, and it compares
    // ids rather than assuming any URL row is stale. Two requests adding the same repository can
    // each miss the github-id lookup (the row does not exist yet) and then find the *other*
    // request's freshly committed row by URL: that row carries this very `githubId`, so it is this
    // repository and is reused, not freed.
    //
    // Only a URL row carrying a *different* non-null id is a different repository at a recycled URL
    // (deleted private repo, then a public one created at the same path). Reusing it would swap the
    // row's GitHub ID while keeping the old private source's chunks and `ready` status, so the new
    // repository would be answered from the previous owner's code.
    //
    // That row still occupies the unique `url` column, so the insert below would fail on the
    // constraint. Release the URL from the *old* row rather than touching its identity: the old
    // repository keeps its `github_id`, chunks, conversations and associations, and is still
    // reachable by `github_id` (which is how sync, ingestion and access checks all find it). Only
    // the URL that now belongs to a different repository is freed.
    let existing = existingByGithubId;
    if (!existing) {
      const urlRowResolution = await db.transaction(async (tx) => {
        const [urlRow] = await tx
          .select()
          .from(repositories)
          .where(eq(repositories.url, meta.html_url))
          .limit(1)
          .for("update");

        if (!urlRow) return null;

        if (urlRow.githubId === githubId) {
          return urlRow;
        }

        if (urlRow.githubId === null) {
          // Legacy row: adopt it and backfill the id so it is findable by github id from now on.
          await tx
            .update(repositories)
            .set({ githubId, updatedAt: new Date() })
            .where(eq(repositories.id, urlRow.id));
          return { ...urlRow, githubId };
        }

        // Free the unique slot from the old row only. Appending the id keeps the old URL on the row
        // for debugging. The only cost is that Retry on that row now fails URL parsing, which it
        // would anyway: GitHub no longer serves it there.
        await tx
          .update(repositories)
          .set({
            url: `${meta.html_url}#stale-${urlRow.githubId.toString()}`,
            updatedAt: new Date(),
          })
          .where(eq(repositories.id, urlRow.id));
        return null;
      });

      if (urlRowResolution) {
        existing = urlRowResolution;
      }
    }

    // repositories rows are shared across users and keyed by githubId, so the indexed branch
    // belongs to every associated user. Reject a different branch instead of silently serving
    // another branch's content or overwriting the branch other users depend on.
    if (existing?.defaultBranch && existing.defaultBranch !== targetBranch) {
      return NextResponse.json(
        {
          error: `This repository is already indexed on branch '${existing.defaultBranch}'. Re-index it on '${targetBranch}' to switch branches.`,
        },
        { status: 409 },
      );
    }

    const now = new Date();
    let shouldStartIngest = false;
    let shouldRetryEmbeddingsOnly = false;

    // Step 8 attaches this repository to the user. Step D of the detach route takes the same
    // `SELECT ... FOR UPDATE` on this row, so a concurrent remove cannot decide "nobody is
    // associated" while this insert is still in flight and delete the row out from under it.
    const defaultMeta = getDefaultEmbeddingMetadataForVisibility(isPrivate);

    if (existing) {
      repoId = existing.id;

      const renamedOrTransferred =
        existing.name !== meta.name ||
        existing.owner !== meta.owner.login ||
        existing.url !== meta.html_url;

      // Verified visibility must be saved whether or not the repository was renamed. A repo that
      // flips public -> private without a rename previously kept isPrivate = false, so
      // runEmbedBatch read the stale value and sent private source to Gemini.
      if (renamedOrTransferred || Boolean(existing.isPrivate) !== isPrivate) {
        // headCommitSha is deliberately not written here: the ingestion pipeline records it after a
        // successful ingest. Writing it early makes the workflow's unchanged-SHA skip fire and leaves
        // the repository permanently un-indexed.
        await db
          .update(repositories)
          .set({
            ...(renamedOrTransferred
              ? {
                  name: meta.name,
                  owner: meta.owner.login,
                  url: meta.html_url,
                  description: meta.description,
                  primaryLanguage: meta.language,
                }
              : {}),
            defaultBranch: targetBranch,
            isPrivate,
            embeddingProvider: existing.embeddingProvider ?? defaultMeta.embeddingProvider,
            embeddingModel: existing.embeddingModel ?? defaultMeta.embeddingModel,
            embeddingDimensions: existing.embeddingDimensions ?? defaultMeta.embeddingDimensions,
            updatedAt: now,
          })
          .where(eq(repositories.id, existing.id));
      }

      // Recovery path: retry on failed status or stale lease
      const isFailed = existing.embeddingStatus === "failed";
      const isStale =
        existing.embeddingStatus === "processing" &&
        (!existing.embeddingLeaseExpiresAt || existing.embeddingLeaseExpiresAt < now);

      // Chunks already exist means ingestion finished and only embedding failed. Re-running
      // ingestion there is wrong twice over: Free users are rejected by the incremental-reindex
      // check, and unchanged files return `skipped`, which never triggers embedding. Restart the
      // embedding workflow directly instead.
      if (isFailed || isStale) {
        const [pending] = await db
          .select({ id: chunks.id })
          .from(chunks)
          .where(and(eq(chunks.repositoryId, existing.id), isNull(chunks.embedding)))
          .limit(1);

        shouldRetryEmbeddingsOnly = Boolean(pending);
        shouldStartIngest = !shouldRetryEmbeddingsOnly;
        await db
          .update(repositories)
          .set({
            defaultBranch: targetBranch,
            embeddingStatus: "processing",
            embeddingLeaseExpiresAt: null,
            updatedAt: now,
          })
          .where(eq(repositories.id, existing.id));
      }
    } else {
      // The row itself is created inside the limit-check transaction below. Inserting it here
      // would leave an unowned `processing` row behind whenever the limit rejects the request,
      // which sync would then pick up as real work.
      shouldStartIngest = true;
    }

    // 8. Enforce the plan repository limit and create the repository + association in one
    // transaction. The user row lock is held across the inserts, so two concurrent requests cannot
    // both observe the same count and both insert. Existing associations are exempt, which keeps
    // retry and re-add paths working for users already at their limit. The repository row lock
    // serializes this attach against a concurrent DELETE /api/repos/[id].
    const limitCheck = await db.transaction(async (tx) => {
      // A brand-new repository has no association yet, so it cannot be exempt; pass the id only
      // when the row already exists.
      const check = await checkRepositoryLimit(
        tx as unknown as Database,
        session.user.id,
        existing?.id,
      );
      if (!check.allowed) return { ...check, repoId: existing?.id };

      let targetRepoId = existing?.id;
      if (!targetRepoId) {
        const [inserted] = await tx
          .insert(repositories)
          .values({
            githubId,
            name: meta.name,
            owner: meta.owner.login,
            url: meta.html_url,
            defaultBranch: targetBranch,
            description: meta.description,
            primaryLanguage: meta.language,
            isPrivate,
            embeddingProvider: defaultMeta.embeddingProvider,
            embeddingModel: defaultMeta.embeddingModel,
            embeddingDimensions: defaultMeta.embeddingDimensions,
            embeddingStatus: "processing",
          })
          .returning();
        targetRepoId = inserted.id;
      }

      // Matches the lock the detach route holds while it recounts associations.
      await tx
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, targetRepoId))
        .for("update");

      const [alreadyJoined] = await tx
        .select()
        .from(userRepositories)
        .where(
          and(
            eq(userRepositories.userId, session.user.id),
            eq(userRepositories.repositoryId, targetRepoId),
          ),
        )
        .limit(1);

      if (!alreadyJoined) {
        await tx.insert(userRepositories).values({
          userId: session.user.id,
          repositoryId: targetRepoId,
        });
      }
      return { ...check, repoId: targetRepoId };
    });

    repoId = limitCheck.repoId;

    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: `Repository limit reached for your plan (${limitCheck.currentCount}/${limitCheck.limit} repositories). Upgrade your plan to add more repositories.`,
        },
        { status: 403 },
      );
    }

    if (shouldRetryEmbeddingsOnly) {
      // Chunks are already parsed; only the embedding pass failed. Restarting ingestion would be
      // rejected for Free users with tracked files and would return `skipped` for unchanged files,
      // leaving recovery to the daily cron instead of the user's Retry button.
      await start(embedRepository, [{ repositoryId: repoId }]);
    } else if (shouldStartIngest) {
      // Start ingestion workflow
      await start(ingestRepository, [
        {
          owner: meta.owner.login,
          repo: meta.name,
          authToken: userToken,
          revision: treeRevision,
          userId: session.user.id,
        },
      ]);
    }

    return NextResponse.json({
      success: true,
      repositoryId: repoId,
      alreadyExists: !!existing,
      status: shouldRetryEmbeddingsOnly
        ? "processing"
        : (existing?.embeddingStatus ?? "processing"),
    });
  } catch (error) {
    console.error("[POST /api/repos] Error:", error);
    return NextResponse.json({ error: "Failed to add repository" }, { status: 500 });
  }
}

