/**
 * Lightweight structured server-side logging for DRAG.
 * Emits JSON-formatted structured log entries for RAG observability.
 */

export interface StructuredLogPayload {
  event:
    | "chat_retrieval"
    | "chat_embedding"
    | "chat_llm_stream"
    | "chat_stream_failure"
    | "repo_indexing_status"
    | "rate_limit_exceeded"
    | "workflow_failure"
    | "ingestion_failure"
    | "embedding_failure";
  traceId?: string;
  durationMs?: number;
  repositoryId?: string;
  conversationId?: string;
  resultCount?: number;
  chunksCount?: number;
  filesIndexed?: number;
  status?: string;
  error?: string;
  retrievalStrategy?: string;
  contextCharCount?: number;
  citationsCount?: number;
  responseCharCount?: number;
  [key: string]: unknown;
}

const SENSITIVE_KEY_RE = /^(authToken|token|secret|password|apiKey|authorization|privateKey)$/i;
const SENSITIVE_PATTERN_RE =
  /(ghp_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+|nvapi-[a-zA-Z0-9_-]+|bearer\s+[a-zA-Z0-9._-]+|-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----)/i;

export function scrubSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    if (SENSITIVE_PATTERN_RE.test(obj)) {
      return "[REDACTED]";
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(scrubSensitiveData);
  }

  if (typeof obj === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        scrubbed[k] = "[REDACTED]";
      } else {
        scrubbed[k] = scrubSensitiveData(v);
      }
    }
    return scrubbed;
  }

  return obj;
}

export function logStructuredEvent(payload: StructuredLogPayload): void {
  const timestamp = new Date().toISOString();
  const sanitized = scrubSensitiveData(payload) as StructuredLogPayload;
  const entry = {
    timestamp,
    ...sanitized,
  };

  // Structured single-line JSON log for serverless and log aggregators
  console.log(`[DRAG_OBSERVABILITY] ${JSON.stringify(entry)}`);
}
