import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import {
  answerConversation,
  defaultConversationChatDeps,
} from "@/lib/chat/conversation";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/app/components/workspace/types";
import { checkRateLimit } from "@/lib/rateLimit/rateLimiter";
import {
  getUserEntitlements,
  checkAndConsumeMonthlyQueryQuota,
  rollbackMonthlyQueryQuota,
} from "@/lib/plans/entitlements";


const RATE_LIMIT_ACTION = "chat";
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 2. Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }

    const { conversationId, message, isRetry, retryMessageId, model, responseMode: rawMode } = body as {
      conversationId?: unknown;
      message?: unknown;
      isRetry?: unknown;
      retryMessageId?: unknown;
      model?: unknown;
      responseMode?: unknown;
    };
    if (typeof conversationId !== "string" || !conversationId) {
      return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
    }
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const responseMode =
      rawMode === "detailed" || rawMode === "explain_simply" ? rawMode : "precise";

    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message exceeds maximum allowed length of ${MAX_CHAT_MESSAGE_LENGTH} characters.` },
        { status: 400 },
      );
    }

    // 3. Enforce rate limit
    const rateLimit = await checkRateLimit(db, {
      userId,
      action: RATE_LIMIT_ACTION,
      maxRequests: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Rate limit exceeded for chat." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
          },
        },
      );
    }

    // 4. Enforce monthly RAG query quota (calendar month)
    const entitlements = await getUserEntitlements(db, userId);
    const quotaResult = await checkAndConsumeMonthlyQueryQuota(
      db,
      userId,
      entitlements.monthlyQueryLimit,
    );

    if (!quotaResult.allowed) {
      return NextResponse.json(
        {
          error: `Monthly RAG query quota exceeded (${quotaResult.count}/${quotaResult.limit} queries used this calendar month). Upgrade your plan for additional queries.`,
          code: "MONTHLY_QUOTA_EXCEEDED",
          count: quotaResult.count,
          limit: quotaResult.limit,
          resetAt: quotaResult.resetAt,
        },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil((quotaResult.resetAt - Date.now()) / 1000).toString(),
          },
        },
      );
    }

    // 5. Delegate to the conversation module.
    // Unmetered plans consume nothing, so there is nothing to roll back for them. The rollback is
    // scoped to the window that was actually consumed: at month end the "current" window is the
    // next one, and decrementing it would erase a different month's usage.
    const consumedWindowEnd = new Date(quotaResult.resetAt);
    const consumed = quotaResult.limit !== null;
    let result: Awaited<ReturnType<typeof answerConversation>>;
    try {
      result = await answerConversation(defaultConversationChatDeps(), {
        userId,
        conversationId,
        message,
        isRetry: typeof isRetry === "boolean" ? isRetry : undefined,
        retryMessageId: typeof retryMessageId === "string" ? retryMessageId : undefined,
        model: typeof model === "string" && model.trim() ? model.trim() : undefined,
        responseMode,
        getGithubToken: () =>
          auth.api
            .getAccessToken({
              body: { providerId: "github" },
              headers: request.headers,
            })
            .then((r) => r?.accessToken ?? null),
      });
    } catch (err) {
      // Upstream failure before streaming: release the consumed query
      if (consumed) await rollbackMonthlyQueryQuota(db, userId, consumedWindowEnd);
      throw err;
    }

    if (!result.ok) {
      // Rollback consumed query on non-successful RAG response
      if (consumed) await rollbackMonthlyQueryQuota(db, userId, consumedWindowEnd);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return new Response(result.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API Error] /api/chat route failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process chat" },
      { status: 500 },
    );
  }
}
