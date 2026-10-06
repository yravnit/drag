import { start } from "workflow/api";
import { ingestRepository } from "@/workflows/ingest";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { GitHubApiClient, type GitHubTreeResponse } from "@/lib/ingestion/githubApiClient";
import { checkRateLimit } from "@/lib/rateLimit/rateLimiter";
import { getUserAccessMode } from "@/lib/auth/accessMode";
import {
  getUserEntitlements,
  checkRepositoryLimit,
  assertPlanRepositoryEntitlements,
  resolveAndValidateBranch,
} from "@/lib/plans/entitlements";
import { getDefaultEmbeddingMetadataForVisibility } from "@/lib/embeddings/router";
import { repositories, userRepositories } from "@/db/schema";
import { and, eq } from "drizzle-orm";

import { db, type Database } from "@/db/db";

/** GitHub-allowed name format: alphanumeric, hyphens, underscores, dots (no path traversal). */
const GITHUB_NAME_RE = /^[\w.-]+$/;

class RepositoryLimitError extends Error {
  constructor(
    readonly currentCount: number,
    readonly limit: number,
  ) {
    super("Repository limit reached");
  }
}

// Rate limiting: 5 ingestion requests per user per 1-hour window, persisted in Postgres
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ACTION = "ingest-repository";

interface ValidatedPayload {
  owner: string;
  repo: string;
  revision?: string;
  batchSize?: number;
  extraIgnorePatterns?: string[];
}

function validateIngestPayload(body: unknown): ValidatedPayload {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Payload must be a non-null object");
  }

  const record = body as Record<string, unknown>;

  if (typeof record.owner !== "string" || !record.owner.trim()) {
    throw new Error('Required field "owner" must be a non-empty string');
  }
  if (!GITHUB_NAME_RE.test(record.owner)) {
    throw new Error(
      'Invalid "owner": must match GitHub name format (alphanumeric, hyphens, underscores, dots only)',
    );
  }

  if (typeof record.repo !== "string" || !record.repo.trim()) {
    throw new Error('Required field "repo" must be a non-empty string');
  }
  if (!GITHUB_NAME_RE.test(record.repo)) {
    throw new Error(
      'Invalid "repo": must match GitHub name format (alphanumeric, hyphens, underscores, dots only)',
    );
  }

  if ("authToken" in record && record.authToken !== undefined) {
    throw new Error(
      'Client-supplied "authToken" is forbidden. Authentication is derived from the server session.',
    );
  }

  const result: ValidatedPayload = {
    owner: record.owner,
    repo: record.repo,
  };

  if ("revision" in record) {
    if (record.revision !== undefined && typeof record.revision !== "string") {
      throw new Error('"revision" must be a string');
    }
    result.revision = record.revision;
  }

  if ("batchSize" in record) {
    if (record.batchSize !== undefined) {
      if (
        typeof record.batchSize !== "number" ||
        !Number.isInteger(record.batchSize) ||
        record.batchSize < 1
      ) {
        throw new Error('"batchSize" must be a positive integer');
      }
      result.batchSize = record.batchSize;
    }
  }

  if ("extraIgnorePatterns" in record) {
    if (record.extraIgnorePatterns !== undefined) {
      if (
        !Array.isArray(record.extraIgnorePatterns) ||
        !record.extraIgnorePatterns.every((item) => typeof item === "string")
      ) {
        throw new Error('"extraIgnorePatterns" must be an array of strings');
      }
      result.extraIgnorePatterns = record.extraIgnorePatterns;
    }
  }

  return result;
}

/**
 * POST /api/workflows/ingest-repository
 *
 * Triggers the repository ingestion workflow.
 * Payload: { owner, repo, revision?, batchSize?, extraIgnorePatterns? }
 */
export async function POST(request: Request) {
  try {
    let bodyUnknown: unknown;
    try {
      bodyUnknown = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    let payload: ValidatedPayload;
    try {
      payload = validateIngestPayload(bodyUnknown);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    // 1. Authenticate caller
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Enforce rate limit
    const rateLimit = await checkRateLimit(db, {
      userId: session.user.id,
      action: RATE_LIMIT_ACTION,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Rate limit exceeded for repository ingestion." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
          },
        },
      );
    }

    // 3. Authorize access to owner/repo using user's GitHub OAuth token from authenticated session
    const tokenRes = await auth.api.getAccessToken({
      body: { providerId: "github" },
      headers: request.headers,
    });
    const userToken = tokenRes?.accessToken ?? undefined;

    if (!userToken) {
      return NextResponse.json(
        { error: "Forbidden: No linked GitHub OAuth credentials found" },
        { status: 403 },
      );
    }

    const client = new GitHubApiClient({ authToken: userToken });
    let repoMeta;
    try {
      repoMeta = await client.getRepository(payload.owner, payload.repo);
    } catch {
      return NextResponse.json(
        {
          error: `Forbidden: Denied access to repository '${payload.owner}/${payload.repo}' on GitHub`,
        },
        { status: 403 },
      );
    }

    if (repoMeta.private) {
      const accessMode = await getUserAccessMode(db, session.user.id);
      if (accessMode === "public") {
        return NextResponse.json(
          {
            error:
              "Forbidden: Private repositories are not permitted in Public-only access mode. Please upgrade to Full repository access.",
          },
          { status: 403 },
        );
      }
    }

    // 4. Resolve user entitlements and enforce plan policies.
    // The resolved branch is assigned back onto the payload: without it the workflow resolves the
    // repository's GitHub default branch itself, which bypasses the main-only Free/Hobby policy.
    const entitlements = await getUserEntitlements(db, session.user.id);

    let targetBranch: string;
    try {
      targetBranch = resolveAndValidateBranch(entitlements, payload.revision);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
    payload.revision = targetBranch;

    let treeData: GitHubTreeResponse;
    try {
      treeData = await client.getTree(payload.owner, payload.repo, targetBranch, true);
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
        {
          error: `Repository tree is too large (truncated by GitHub). Max allowed is ${entitlements.fileLimit} files.`,
        },
        { status: 400 },
      );
    }

    let fileCount = 0;
    let totalSizeBytes = 0;
    for (const item of treeData.tree || []) {
      if (item.type === "blob") {
        fileCount++;
        totalSizeBytes += item.size || 0;
      }
    }

    try {
      assertPlanRepositoryEntitlements(entitlements, {
        branch: targetBranch,
        fileCount,
        totalSizeBytes,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }

    const githubId = repoMeta?.id !== undefined ? BigInt(repoMeta.id) : null;
    let existing = null;
    if (githubId !== null) {
      const [record] = await db
        .select({ id: repositories.id, defaultBranch: repositories.defaultBranch })
        .from(repositories)
        .where(eq(repositories.githubId, githubId))
        .limit(1);
      existing = record;
    }

    if (existing) {
      // repositories rows are shared across users and keyed by githubId, so the indexed branch
      // belongs to every associated user. Reject a different branch instead of silently serving
      // another branch's content or overwriting the branch other users depend on. Mirrors the
      // guard in POST /api/repos; without it this route re-ingests the shared row on the
      // requested branch while defaultBranch still reads the old one, so every other user of
      // the row is served the wrong code and sync then ping-pongs between the two branches.
      if (existing.defaultBranch && existing.defaultBranch !== targetBranch) {
        return NextResponse.json(
          {
            error: `This repository is already indexed on branch '${existing.defaultBranch}'. Re-index it on '${targetBranch}' to switch branches.`,
          },
          { status: 409 },
        );
      }

      if (!entitlements.incrementalReindexAllowed) {
        return NextResponse.json(
          {
            error:
              "Incremental reindexing is disabled on the Free plan. Upgrade to Hobby to enable incremental reindexing.",
          },
          { status: 403 },
        );
      }
    }

    // Repository row + association in one transaction, with the plan limit checked under the
    // user row lock so concurrent requests cannot both pass the limit.
    try {
      await db.transaction(async (tx) => {
        let targetRepoId = existing?.id;

        if (!targetRepoId) {
          const [inserted] = await tx
            .insert(repositories)
            .values({
              ...(githubId !== null ? { githubId } : {}),
              name: payload.repo,
              owner: payload.owner,
              url: repoMeta.html_url,
              defaultBranch: targetBranch,
              description: repoMeta.description ?? null,
              primaryLanguage: repoMeta.language ?? null,
              isPrivate: Boolean(repoMeta.private),
              embeddingStatus: "processing",
              ...getDefaultEmbeddingMetadataForVisibility(Boolean(repoMeta.private)),
            })
            .returning({ id: repositories.id });
          targetRepoId = inserted.id;
        }

        const limitCheck = await checkRepositoryLimit(
          tx as unknown as Database,
          session.user.id,
          targetRepoId,
        );
        if (!limitCheck.allowed) {
          throw new RepositoryLimitError(limitCheck.currentCount, limitCheck.limit);
        }

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

        return targetRepoId;
      });
    } catch (err) {
      if (err instanceof RepositoryLimitError) {
        return NextResponse.json(
          {
            error: `Repository limit reached for your plan (${err.currentCount}/${err.limit} repositories). Upgrade your plan to add more repositories.`,
          },
          { status: 403 },
        );
      }
      throw err;
    }

    // Enforce matching token and userId in the payload passed to the workflow
    const workflowPayload = {
      ...payload,
      authToken: userToken,
      userId: session.user.id,
    };

    const run = await start(ingestRepository, [workflowPayload]);

    return NextResponse.json({
      message: "Ingestion workflow started",
      runId: run.runId,
      owner: payload.owner,
      repo: payload.repo,
    });
  } catch (error) {
    console.error("[API Error] Ingestion route failed:", error);
    return NextResponse.json({ error: "Failed to start ingestion workflow" }, { status: 500 });
  }
}
