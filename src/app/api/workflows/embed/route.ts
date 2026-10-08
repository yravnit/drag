import { start } from "workflow/api";
import { embedRepository, EmbedPayload } from "@/workflows/embed";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { assertRepositoryAssociation } from "@/lib/access/repositoryAccess";
import { isCronAuthorized } from "@/lib/cron/cronAuth";
import { checkRateLimit } from "@/lib/rateLimit/rateLimiter";

const RATE_LIMIT_ACTION = "embed-workflow";
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/workflows/embed
 *
 * Triggers the chunk embedding generation workflow for a specific repository.
 * Payload: { repositoryId }
 */
export async function POST(request: Request) {
  try {
    let body: EmbedPayload;
    try {
      body = (await request.json()) as EmbedPayload;
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    if (!body || typeof body !== "object" || !body.repositoryId) {
      return NextResponse.json(
        { error: 'Missing required field: "repositoryId"' },
        { status: 400 },
      );
    }

    // 1. Authorize caller: internal cron/workflow secret OR authenticated user with repo access
    const isInternal = isCronAuthorized(request);

    if (!isInternal) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const hasAccess = await assertRepositoryAssociation(
        db,
        session.user.id,
        body.repositoryId,
      );

      if (!hasAccess) {
        return NextResponse.json(
          { error: "Forbidden: You do not have access to this repository" },
          { status: 403 },
        );
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
          { error: "Too many requests. Rate limit exceeded for embed workflow." },
          {
            status: 429,
            headers: {
              "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
            },
          },
        );
      }
    }

    const run = await start(embedRepository, [body]);

    return NextResponse.json({
      message: "Embeddings workflow started",
      runId: run.runId,
      repositoryId: body.repositoryId,
    });
  } catch (error) {
    console.error("[API Error] Embeddings route failed:", error);
    return NextResponse.json({ error: "Failed to start embeddings workflow" }, { status: 500 });
  }
}
