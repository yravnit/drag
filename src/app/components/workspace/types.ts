/** Citation attached to an assistant message; indices match inline markers like [1]. */
export interface Citation {
  index: number;
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  text: string;
}

/** Repository row as serialized by GET /api/repos. */
export interface WorkspaceRepository {
  id: string;
  githubId: string | null;
  name: string;
  owner: string;
  url: string;
  defaultBranch: string | null;
  description: string | null;
  primaryLanguage: string | null;
  indexedAt: string | null;
  embeddingStatus: string | null;
  filesIndexed?: number;
  chunksCount?: number;
  createdAt: string;
  isPrivate?: boolean;
  privacyLabel?: string;
  embeddingLabel?: string;
  privacyDisclosure?: string;
  totalSizeBytes?: number | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  /** Only populated by `/api/repos/[id]/status`; the list endpoint does not return it. */
  headCommitSha?: string | null;
}

/** Ingestion and embedding status tracker for selected repository. */
export interface StatusTracker {
  id: string;
  embeddingStatus: string;
  stage?: "preparing" | "indexing" | "embedding" | "ready" | "failed";
  indexedAt: string | null;
  filesIndexed?: number;
  chunksCount?: number;
  embeddedChunksCount?: number;
  totalSizeBytes?: number | null;
  defaultBranch?: string | null;
  primaryLanguage?: string | null;
  headCommitSha?: string | null;
  syncStatus?: string | null;
  isPrivate?: boolean;
  privacyLabel?: string;
  embeddingLabel?: string;
  privacyDisclosure?: string;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
}

export type ResponseMode = "precise" | "detailed" | "explain_simply";

/**
 * Maximum characters in one user prompt. Enforced on the textarea and again in `POST /api/chat`,
 * so a client that skips the input attribute still cannot overrun it. Lives here because
 * `types.ts` imports nothing and is already shared by the client and the route.
 */
export const MAX_CHAT_MESSAGE_LENGTH = 4000;

/** Conversation row as serialized by GET /api/conversations. */
export interface ConversationThread {
  id: string;
  repositoryId: string;
  title: string;
}

/** Message row as serialized by GET /api/conversations/[id]/messages. */
export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  status: string;
  citations?: Citation[] | null;
}

/** Repository option as serialized by GET /api/github/repos. */
export interface GithubRepoOption {
  githubId: string;
  name: string;
  owner: string;
  fullName: string;
  url: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  requiresUpgrade?: boolean;
}

/** User plan, pricing, entitlements, and usage as serialized by GET /api/user/plan. */
export interface PlanUsageData {
  plan: "free" | "hobby" | "enterprise" | "boss";
  pricing: {
    amount: string;
    cadence: string;
    currency: string;
    displayPrice: string;
    description: string;
  };
  entitlements: {
    plan: "free" | "hobby" | "enterprise" | "boss";
    repositoryLimit: number;
    monthlyQueryLimit: number | null;
    repositorySizeLimitBytes: number;
    fileLimit: number;
    allowedBranch: string;
    incrementalReindexAllowed: boolean;
  };
  usage: {
    repositoriesCount: number;
    monthlyQueriesCount: number;
    monthlyQueriesResetAt: number;
  };
}

/** NVIDIA Model candidate item serialized by GET /api/nvidia-models. */
export interface NvidiaModelOption {
  id: string;
  latencyMs: number | null;
}

/** Full ordered id list after a sidebar drag, persisted by PATCH /api/repos/reorder. */
export type ReorderRepositoriesHandler = (orderedIds: string[]) => void;

/** Per-repository ordered thread ids after a drag, persisted by PATCH /api/conversations/reorder. */
export type ReorderConversationsHandler = (repositoryId: string, orderedIds: string[]) => void;
