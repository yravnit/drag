export type RetrievalBenchmarkCategory =
  | "exact_identifiers"
  | "file_path_lookup"
  | "configuration"
  | "error_debugging"
  | "architecture"
  | "implementation_questions"
  | "cross_file_reasoning"
  | "function"
  | "class"
  | "config"
  | "error"
  | "concept";

export interface RetrievalEvalQuery {
  id: string;
  query: string;
  category: RetrievalBenchmarkCategory;
  expectedFiles: string[];
  expectedSymbols?: string[];
  description?: string;
}

export const RETRIEVAL_EVAL_DATASET: RetrievalEvalQuery[] = [
  // Exact functions and classes (exact_identifiers)
  {
    id: "fn-isSensitiveFile",
    query: "isSensitiveFile",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/fileFilter.ts"],
    expectedSymbols: ["isSensitiveFile"],
    description: "Exact function name for sensitive file filtering",
  },
  {
    id: "fn-isPrivateSecretKey",
    query: "isPrivateSecretKey",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/fileFilter.ts"],
    expectedSymbols: ["isPrivateSecretKey"],
    description: "Exact function detecting private keys and certificates",
  },
  {
    id: "fn-chunkFile",
    query: "chunkFile",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/semanticChunker.ts"],
    expectedSymbols: ["chunkFile"],
    description: "Exact function generating AST semantic chunks",
  },
  {
    id: "fn-isTransientDatabaseError",
    query: "isTransientDatabaseError",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/dbLayer.ts"],
    expectedSymbols: ["isTransientDatabaseError"],
    description: "Transient error checker for database retry logic",
  },
  {
    id: "fn-persistProcessedFilesChunks",
    query: "persistProcessedFilesChunks",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/dbLayer.ts"],
    expectedSymbols: ["persistProcessedFilesChunks"],
    description: "Shared persistence batching helper for chunks",
  },
  {
    id: "fn-claimEmbeddingLease",
    query: "claimEmbeddingLease",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/leases/repositoryLeases.ts"],
    expectedSymbols: ["claimEmbeddingLease"],
    description: "Atomic lease claiming for embedding jobs",
  },
  {
    id: "fn-claimSyncBatch",
    query: "claimSyncBatch",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/leases/repositoryLeases.ts"],
    expectedSymbols: ["claimSyncBatch"],
    description: "Atomic batch lease claim for sync cron",
  },
  {
    id: "fn-findRepositoriesWithPendingEmbeddings",
    query: "findRepositoriesWithPendingEmbeddings",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/leases/repositoryLeases.ts"],
    expectedSymbols: ["findRepositoriesWithPendingEmbeddings"],
    description: "Query to find repositories awaiting embedding",
  },
  {
    id: "fn-sanitizeMermaidSvg",
    query: "sanitizeMermaidSvg",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/mermaid/sanitizeMermaid.ts"],
    expectedSymbols: ["sanitizeMermaidSvg"],
    description: "DOMPurify SVG sanitizer for Mermaid diagrams",
  },
  {
    id: "fn-checkRateLimit",
    query: "checkRateLimit",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/rateLimit/rateLimiter.ts"],
    expectedSymbols: ["checkRateLimit"],
    description: "Atomic database rate limiter function",
  },
  {
    id: "fn-assertRepositoryAccess",
    query: "assertRepositoryAccess",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/access/repositoryAccess.ts"],
    expectedSymbols: ["assertRepositoryAccess"],
    description: "Multi-tenant access assertion helper",
  },
  {
    id: "fn-invalidateRepositoryAccessCache",
    query: "invalidateRepositoryAccessCache",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/access/repositoryAccess.ts"],
    expectedSymbols: ["invalidateRepositoryAccessCache"],
    description: "Access cache invalidation upon repo deletion",
  },
  {
    id: "fn-embedRepository",
    query: "embedRepository",
    category: "exact_identifiers",
    expectedFiles: ["src/workflows/embed.ts"],
    expectedSymbols: ["embedRepository"],
    description: "Vercel Workflow for repository embedding",
  },
  {
    id: "fn-runEmbedBatch",
    query: "runEmbedBatch",
    category: "exact_identifiers",
    expectedFiles: ["src/workflows/embed.ts"],
    expectedSymbols: ["runEmbedBatch"],
    description: "Batch embedding runner step",
  },
  {
    id: "fn-answerConversation",
    query: "answerConversation",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/chat/conversation.ts"],
    expectedSymbols: ["answerConversation"],
    description: "Main chat generation and retrieval orchestrator",
  },
  {
    id: "class-ParserManager",
    query: "ParserManager",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/parserManager.ts"],
    expectedSymbols: ["ParserManager"],
    description: "Bounded Tree-sitter parser manager class",
  },
  {
    id: "class-IngestionDatabaseLayer",
    query: "IngestionDatabaseLayer",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/ingestion/dbLayer.ts"],
    expectedSymbols: ["IngestionDatabaseLayer"],
    description: "Database access layer for repository ingestion",
  },
  {
    id: "class-NimLLMProvider",
    query: "NimLLMProvider",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/llm/llmProvider.ts"],
    expectedSymbols: ["NimLLMProvider"],
    description: "NVIDIA NIM LLM provider class",
  },

  // Configuration variables
  {
    id: "class-GeminiEmbeddingProvider",
    query: "GeminiEmbeddingProvider",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/embeddings/geminiEmbeddingProvider.ts"],
    expectedSymbols: ["GeminiEmbeddingProvider"],
    description: "Gemini embedding provider class used for public repositories",
  },
  {
    id: "class-CloudflareEmbeddingProvider",
    query: "CloudflareEmbeddingProvider",
    category: "exact_identifiers",
    expectedFiles: ["src/lib/embeddings/cloudflareEmbeddingProvider.ts"],
    expectedSymbols: ["CloudflareEmbeddingProvider"],
    description: "Cloudflare Workers AI embedding provider class used for private repositories",
  },
  {
    id: "cfg-EMBEDDING_DIMENSIONS",
    query: "EMBEDDING_DIMENSIONS",
    category: "configuration",
    expectedFiles: ["src/db/schemas/chunks.ts"],
    description: "Vector dimensions configuration constant",
  },
  {
    id: "cfg-RATE_LIMIT_ACTIONS",
    query: "RATE_LIMIT_ACTIONS",
    category: "configuration",
    expectedFiles: ["src/lib/rateLimit/rateLimiter.ts"],
    description: "Rate limit action configurations and thresholds",
  },
  {
    id: "cfg-SUPPORTED_EXTENSIONS",
    query: "SUPPORTED_EXTENSIONS",
    category: "configuration",
    expectedFiles: ["src/lib/ingestion/fileFilter.ts"],
    description: "Allowed file extensions for code ingestion",
  },

  // Error messages
  {
    id: "err-nvidia-key-missing",
    query: "NVIDIA_API_KEY environment variable is missing",
    category: "error_debugging",
    expectedFiles: ["src/lib/llm/llmProvider.ts"],
    description: "Missing NVIDIA API key error message",
  },

  // File and path lookup
  {
    id: "arch-where-file-filter",
    query: "Where are sensitive and secret files filtered during repository ingestion?",
    category: "file_path_lookup",
    expectedFiles: ["src/lib/ingestion/fileFilter.ts"],
    description: "Lookup for sensitive file exclusion logic",
  },

  // Architecture and system design
  {
    id: "arch-how-lease-works",
    query: "How does atomic lease claiming prevent concurrent sync jobs using skip locked?",
    category: "architecture",
    expectedFiles: ["src/lib/leases/repositoryLeases.ts"],
    description: "Architecture query on lease concurrency",
  },
  {
    id: "arch-mermaid-sanitize",
    query: "How is SVG sanitized before rendering Mermaid diagrams?",
    category: "architecture",
    expectedFiles: ["src/lib/mermaid/sanitizeMermaid.ts"],
    description: "Architecture query on Mermaid SVG DOMPurify sanitization",
  },

  // Implementation questions
  {
    id: "impl-llm-stream-failure",
    query: "What happens when the LLM stream throws mid-stream in conversation?",
    category: "implementation_questions",
    expectedFiles: ["src/lib/chat/conversation.ts"],
    description: "Implementation query on mid-stream failure handling",
  },
  {
    id: "impl-db-retry-transient",
    query: "How are transient PostgreSQL database connection errors retried with exponential backoff?",
    category: "implementation_questions",
    expectedFiles: ["src/lib/ingestion/dbLayer.ts"],
    description: "Implementation query on transient database retry",
  },
];
