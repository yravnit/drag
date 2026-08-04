import { start } from "workflow/api";
import { ingestRepository } from "@/workflows/ingest";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { GitHubApiClient } from "@/lib/ingestion/githubApiClient";

/** GitHub-allowed name format: alphanumeric, hyphens, underscores, dots (no path traversal). */
const GITHUB_NAME_RE = /^[\w.-]+$/;

// Simple in-memory rate limiting to protect ingestion operations (e.g. 5 requests per user per hour)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const limit = rateLimitMap.get(userId);

  if (!limit || now > limit.resetAt) {
    const newLimit = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(userId, newLimit);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: newLimit.resetAt };
  }

  if (limit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: limit.resetAt };
  }

  limit.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - limit.count,
    resetAt: limit.resetAt,
  };
}

interface ValidatedPayload {
  owner: string;
  repo: string;
  authToken?: string;
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

  const result: ValidatedPayload = {
    owner: record.owner,
    repo: record.repo,
  };

  if ("authToken" in record) {
    if (record.authToken !== undefined && typeof record.authToken !== "string") {
      throw new Error('"authToken" must be a string');
    }
    result.authToken = record.authToken;
  }

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
    const rateLimit = checkRateLimit(session.user.id);
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

    // 3. Authorize access to owner/repo using user's GitHub OAuth token
    // If payload contains an authToken, we can use that (e.g. for API/internal triggers),
    // otherwise retrieve from the user's social login session.
    let userToken = payload.authToken;
    if (!userToken) {
      const tokenRes = await auth.api.getAccessToken({
        body: { providerId: "github" },
        headers: request.headers,
      });
      userToken = tokenRes?.accessToken ?? undefined;
    }

    if (!userToken) {
      return NextResponse.json(
        { error: "Forbidden: No linked GitHub OAuth credentials found" },
        { status: 403 },
      );
    }

    const client = new GitHubApiClient({ authToken: userToken });
    try {
      await client.getRepository(payload.owner, payload.repo);
    } catch {
      return NextResponse.json(
        {
          error: `Forbidden: Denied access to repository '${payload.owner}/${payload.repo}' on GitHub`,
        },
        { status: 403 },
      );
    }

    // Enforce matching token in the payload passed to the workflow
    const workflowPayload = {
      ...payload,
      authToken: userToken,
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
