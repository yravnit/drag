import { Database } from "@/db/db";
import { nvidiaModels } from "@/db/schemas/nvidiaModels";
import { and, eq, notInArray } from "drizzle-orm";

const NVIDIA_MODELS_API_URL = "https://integrate.api.nvidia.com/v1/models";
const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const NON_CHAT_KEYWORDS = [
  "embedding",
  "embed",
  "rerank",
  "parse",
  "guard",
  "safety",
  "reward",
  "riva",
  "translate",
  "translation",
  "ising",
  "calibration",
  "calibrate",
  "detector",
  "clip",
  "deplot",
  "diffusion",
];

/** Upper bound for the /v1/models discovery request so a stalled NVIDIA response cannot hang the cron run. */
const DISCOVERY_TIMEOUT_MS = 10_000;

export interface NvidiaModelCandidate {
  id: string;
  type?: string;
  pipeline_tag?: string;
  capabilities?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProbeResult {
  modelId: string;
  success: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface UsableNvidiaModelsResponse {
  provider: "nvidia";
  checkedAt: string | null;
  models: Array<{
    id: string;
    latencyMs: number | null;
  }>;
}

/**
 * Filters out obvious non-chat models using keyword inspection and metadata attributes.
 * Omit non-LLMs such as embeddings, rerankers, guardrails, translation, calibration, and detectors.
 */
export function isNonChatModel(
  modelId: string,
  metadata?: Partial<NvidiaModelCandidate>,
): boolean {
  const lowerId = modelId.toLowerCase();
  for (const keyword of NON_CHAT_KEYWORDS) {
    if (lowerId.includes(keyword)) {
      return true;
    }
  }

  if (metadata?.type && typeof metadata.type === "string") {
    const lowerType = metadata.type.toLowerCase();
    if (NON_CHAT_KEYWORDS.some((kw) => lowerType.includes(kw))) {
      return true;
    }
  }

  if (metadata?.pipeline_tag && typeof metadata.pipeline_tag === "string") {
    const lowerTag = metadata.pipeline_tag.toLowerCase();
    if (NON_CHAT_KEYWORDS.some((kw) => lowerTag.includes(kw))) {
      return true;
    }
  }

  return false;
}

/**
 * Filters candidate models discovered from NVIDIA's /v1/models endpoint.
 * Supports all LLM providers hosted on the platform while excluding obvious non-chat models.
 */
export function filterNvidiaChatCandidates(
  rawModels: NvidiaModelCandidate[],
): NvidiaModelCandidate[] {
  return rawModels.filter(
    (model) =>
      typeof model.id === "string" &&
      model.id.includes("/") &&
      !isNonChatModel(model.id, model),
  );
}

/**
 * Validates a candidate NVIDIA chat model by executing a minimal real inference probe.
 * Checks HTTP status, valid JSON, and assistant response presence (supporting reasoning tokens).
 */
export async function probeNvidiaChatModel(
  modelId: string,
  apiKey: string,
  options?: {
    endpointUrl?: string;
    timeoutMs?: number;
  },
): Promise<ProbeResult> {
  const endpoint = options?.endpointUrl || NVIDIA_CHAT_COMPLETIONS_URL;
  const timeoutMs = options?.timeoutMs ?? 20_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 16,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      return {
        modelId,
        success: false,
        latencyMs: null,
        error: `HTTP error ${res.status}: ${res.statusText}`,
      };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        modelId,
        success: false,
        latencyMs: null,
        error: "Malformed JSON response",
      };
    }

    const payload = json as {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
        };
        text?: unknown;
      }>;
    };

    const choice = payload?.choices?.[0];
    const message = choice?.message;
    const assistantContent =
      (typeof message?.content === "string" && message.content.trim()) ||
      (typeof message?.reasoning_content === "string" && message.reasoning_content.trim()) ||
      (typeof choice?.text === "string" && choice.text.trim()) ||
      null;

    if (!assistantContent) {
      return {
        modelId,
        success: false,
        latencyMs: null,
        error: "Missing or empty assistant response in chat completion payload",
      };
    }

    return {
      modelId,
      success: true,
      latencyMs,
    };
  } catch (err) {
    const isTimeout =
      (err as Error).name === "AbortError" ||
      (typeof (err as Error).message === "string" &&
        (err as Error).message.toLowerCase().includes("timeout"));

    return {
      modelId,
      success: false,
      latencyMs: null,
      error: isTimeout ? `Request timed out after ${timeoutMs}ms` : (err as Error).message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Runs probes with a concurrency limit.
 * ponytail: batch slice chunking is used rather than p-limit dependency.
 * Ceiling: 5 concurrent requests at a time. Upgrade path: add p-limit or worker pool if probing 500+ models.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map((item) => fn(item)));
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Weekly discovery and validation workflow:
 * 1. Fetches models from https://integrate.api.nvidia.com/v1/models
 * 2. Filters candidates starting with nvidia/ and not non-chat
 * 3. Probes candidates concurrently
 * 4. Persists results to PostgreSQL database
 * If discovery fails entirely, retains previous known-good results and returns failure.
 */
export async function refreshNvidiaModels(
  database: Database,
  apiKey?: string,
  options?: {
    modelsApiUrl?: string;
    chatEndpointUrl?: string;
    timeoutMs?: number;
    concurrency?: number;
  },
): Promise<{
  success: boolean;
  totalDiscovered: number;
  candidatesProbed: number;
  availableCount: number;
  error?: string;
}> {
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      totalDiscovered: 0,
      candidatesProbed: 0,
      availableCount: 0,
      error: "NVIDIA_API_KEY is not configured",
    };
  }

  const modelsUrl = options?.modelsApiUrl || NVIDIA_MODELS_API_URL;
  let rawModels: NvidiaModelCandidate[] = [];

  try {
    const res = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });

    if (!res.ok) {
      return {
        success: false,
        totalDiscovered: 0,
        candidatesProbed: 0,
        availableCount: 0,
        error: `Failed to fetch models from NVIDIA API: HTTP ${res.status}`,
      };
    }

    const body = (await res.json()) as { data?: NvidiaModelCandidate[] };
    rawModels = Array.isArray(body?.data) ? body.data : [];
  } catch (err) {
    return {
      success: false,
      totalDiscovered: 0,
      candidatesProbed: 0,
      availableCount: 0,
      error: `Discovery request failed: ${(err as Error).message}`,
    };
  }

  const candidates = filterNvidiaChatCandidates(rawModels);
  const now = new Date();
  const concurrency = options?.concurrency ?? 5;

  const probeResults = await runWithConcurrency(candidates, concurrency, (candidate) =>
    probeNvidiaChatModel(candidate.id, apiKey, {
      endpointUrl: options?.chatEndpointUrl,
      timeoutMs: options?.timeoutMs,
    }),
  );

  let availableCount = 0;

  for (const result of probeResults) {
    try {
      if (result.success) {
        availableCount++;
        await database
          .insert(nvidiaModels)
          .values({
            modelId: result.modelId,
            status: "available",
            latencyMs: result.latencyMs,
            lastCheckedAt: now,
            lastSuccessAt: now,
            lastError: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: nvidiaModels.modelId,
            set: {
              status: "available",
              latencyMs: result.latencyMs,
              lastCheckedAt: now,
              lastSuccessAt: now,
              lastError: null,
              updatedAt: now,
            },
          });
      } else {
        await database
          .insert(nvidiaModels)
          .values({
            modelId: result.modelId,
            status: "unavailable",
            latencyMs: null,
            lastCheckedAt: now,
            lastError: result.error ?? "Inference probe failed",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: nvidiaModels.modelId,
            set: {
              status: "unavailable",
              latencyMs: null,
              lastCheckedAt: now,
              lastError: result.error ?? "Inference probe failed",
              updatedAt: now,
            },
          });
      }
    } catch (err) {
      console.error(`Failed to persist probe result for ${result.modelId}:`, err);
    }
  }

  // Retire models NVIDIA no longer lists (or that no longer pass the candidate filter),
  // otherwise a removed model stays "available" forever and client requests to it keep failing.
  const probedIds = candidates.map((c) => c.id);
  try {
    await database
      .update(nvidiaModels)
      .set({
        status: "unavailable",
        latencyMs: null,
        lastCheckedAt: now,
        lastError: "No longer listed by NVIDIA discovery",
        updatedAt: now,
      })
      .where(
        and(
          eq(nvidiaModels.status, "available"),
          ...(probedIds.length > 0 ? [notInArray(nvidiaModels.modelId, probedIds)] : []),
        ),
      );
  } catch (err) {
    console.error("Failed to retire stale NVIDIA models:", err);
  }

  return {
    success: true,
    totalDiscovered: rawModels.length,
    candidatesProbed: candidates.length,
    availableCount,
  };
}

/**
 * Reads persisted validated NVIDIA models from PostgreSQL.
 * Strictly reads database without live network probing.
 * Rethrows read failures so callers can distinguish "no verified models" from "read failed".
 */
export async function getPersistedNvidiaModels(
  database: Database,
): Promise<UsableNvidiaModelsResponse> {
  const records = await database
    .select({
      modelId: nvidiaModels.modelId,
      status: nvidiaModels.status,
      latencyMs: nvidiaModels.latencyMs,
      lastCheckedAt: nvidiaModels.lastCheckedAt,
    })
    .from(nvidiaModels)
    .where(eq(nvidiaModels.status, "available"));

  let latestCheckedAt: Date | null = null;
  for (const r of records) {
    if (r.lastCheckedAt && (!latestCheckedAt || r.lastCheckedAt > latestCheckedAt)) {
      latestCheckedAt = r.lastCheckedAt;
    }
  }

  return {
    provider: "nvidia",
    checkedAt: latestCheckedAt ? latestCheckedAt.toISOString() : null,
    models: records.map((r) => ({
      id: r.modelId,
      latencyMs: r.latencyMs,
    })),
  };
}
