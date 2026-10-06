# DRAG — Agent handoff and requirement tracker

> **FOR AGENTS**: Read this document in full at the start of every session before writing any code.
> This is the single source of truth for project state, conventions, and what is/isn't built.

---

## 1. What is DRAG?

Developer Repository Augmented Generation (DRAG) is an AI assistant for software repositories.

A user authenticates with GitHub OAuth, submits a repository URL, the system indexes it (parse, chunk, embed, store), and then the user can chat with the codebase via a retrieval-augmented generation (RAG) pipeline.

Product name: DRAG v1.1  
Stack: Next.js 16, TypeScript, Drizzle ORM, Neon PostgreSQL, pgvector, Better Auth, Vercel Workflow SDK  
Hosting: Vercel  

---

## 2. Design principles

1. Prefer simple solutions over clever ones.
2. Optimize for correctness before performance.
3. Keep every module replaceable. Parser, embeddings, vector store, and LLM must each remain swappable.
4. Design for future expansion without implementing premature features.
5. Follow tutorial architecture as closely as possible; only deviate where repository indexing requires different handling.
6. Always write unit and integration tests for newly created code and files.
7. Be cautious with Drizzle ORM and cross-check official documentation before changing anything that affects Drizzle. The project relies on `drizzle-orm` v1 Release Candidate (`^1.0.0-rc.4`), which introduces breaking changes (for example, Relational Queries v2 `defineRelations(schema, callback)` and `snakeCase.table`). Always verify signatures against Drizzle v1 docs before making database or schema modifications.

---

## 3. Directory structure

```
drag/
├── src/
├── app/
│   ├── layout.tsx              # Root layout (Manrope, Nohemi, Fira Code fonts, dark theme)
│   ├── fonts/nohemi/           # Self-hosted Nohemi woff2 (400/500/600/700)
│   ├── page.tsx                # Thin coordinator for workspace state
│   ├── globals.css             # Font tokens: --font-sans/display/mono, heading display type
│   ├── components/
│   │   └── workspace/          # Modular workspace UI components
│   │       ├── WorkspaceShell.tsx # Root layout coordinator
│   │       ├── Sidebar.tsx        # Responsive desktop sidebar and mobile drawer
│   │       ├── RepoList.tsx       # Repository list with retry button
│   │       ├── ConversationList.tsx # Thread selector and creation
│   │       ├── ChatWindow.tsx     # Main chat panel and indexing progress
│   │       ├── MessageList.tsx    # Message stream and prompt suggestions
│   │       ├── MessageBubble.tsx  # Message item with avatar, status, and Sources chip list
│   │       ├── Composer.tsx       # Textarea input with keyboard submission
│   │       ├── PlanUsageModal.tsx # Free, Hobby, Enterprise plan and quota overview
│   │       ├── ModelSelector.tsx  # NVIDIA model picker, latency chips, fastest-model default
│   │       ├── AddRepoModal.tsx   # Dialog with dynamic repository policy limits
│   │       ├── ConfirmDialog.tsx  # Shared in-app confirm dialog (replaces window.confirm)
│   │       ├── GitHubRepoPicker.tsx # Searchable GitHub repository list
│   │       ├── CitationDrawer.tsx # Code preview drawer with line gutters and GitHub links
│   │       ├── MessageRenderer.tsx # GitHub-Flavored Markdown, code syntax copy, citation markers
│   │       ├── MermaidBlock.tsx   # DOMPurify-sanitized client Mermaid diagrams, code toggle, copy
│   │       ├── CopyCodeButton.tsx # Clipboard button shared by code and diagram blocks
│   │       └── types.ts           # Shared UI component type definitions
│   └── api/
│       ├── auth/
│       │   ├── [...all]/       # Better Auth catch-all route
│       │   └── access-mode/    # GET verified user access mode and scopes
│       ├── user/
│       │   └── plan/           # GET user plan limits and current usage
│       ├── nvidia-models/      # GET currently usable NVIDIA LLMs
│       ├── chat/
│       │   └── route.ts        # POST streaming chat RAG endpoint with rate limiting
│       ├── repos/
│       │   ├── route.ts        # GET user repos list / POST add flow + retry handling
│       │   └── [id]/
│       │       ├── route.ts    # DELETE association + access cache invalidation
│       │       └── status/
│       │           └── route.ts # GET indexing/embedding status
│       ├── conversations/
│       │   ├── route.ts        # GET list threads / POST create conversation
│       │   └── [id]/
│       │       └── messages/
│       │           └── route.ts # GET messages list
│       ├── github/
│       │   ├── repos/
│       │   │   └── route.ts    # GET GitHub owned + org repos list for picker
│       │   └── branches/
│       │       └── route.ts    # GET GitHub branches for selected repository
│       ├── cron/
│       │   ├── embed/
│       │   │   └── route.ts    # Embed reclaim cron
│       │   ├── sync/
│       │   │   └── route.ts    # Sync dispatch cron
│       │   └── nvidia-models/
│       │       └── route.ts    # Weekly NVIDIA model discovery and probe cron
│       └── workflows/
│           ├── embed/
│           │   └── route.ts    # Vercel Workflow embed route (protected)
│           ├── sync/
│           │   └── route.ts    # Vercel Workflow sync route (protected)
│           └── ingest-repository/
│               └── route.ts    # Vercel Workflow ingest route (protected)
│   ├── data/
│   │   ├── serverEnv.ts        # @t3-oss/env-nextjs server env validation
│   │   └── clientEnv.ts        # @t3-oss/env-nextjs client env validation
│   ├── db/
│   │   ├── db.ts               # Drizzle + Neon connection
│   │   ├── schema.ts           # Barrel re-export
│   │   ├── relations.ts        # Drizzle defineRelations (centralized)
│   │   ├── schemas/
│   │   │   ├── auth.ts         # Better Auth tables
│   │   │   ├── repository.ts   # repositories table with githubId
│   │   │   ├── chunks.ts       # chunks table with vector custom type
│   │   │   ├── repositoryFiles.ts # repository_files table (hash tracking)
│   │   │   ├── rateLimits.ts   # DB persistent rate limiting and monthly quota
│   │   │   ├── userRepositories.ts # Join table for multi-tenancy
│   │   │   ├── repositoryAccessCache.ts # Access verification cache
│   │   │   ├── conversations.ts # User conversations
│   │   │   ├── messages.ts      # Thread messages (status: streaming)
│   │   │   └── nvidiaModels.ts  # Validated NVIDIA LLM availability persistence
│   │   └── migrations/         # drizzle-kit generated migrations
│   ├── lib/
│   │   ├── access/
│   │   │   └── repositoryAccess.ts # Access assertion, cache verification, invalidation
│   │   ├── auth/
│   │   │   ├── server.ts       # Better Auth server configuration
│   │   │   ├── client.ts       # Better Auth React client
│   │   │   └── accessMode.ts   # GitHub access mode types, scopes, and DB resolution
│   │   ├── chat/
│   │   │   └── conversation.ts # Message persistence, deduplication, injection defense
│   │   ├── embeddings/
│   │   │   ├── config.ts       # Embedding dimensions
│   │   │   └── embeddingProvider.ts # EmbeddingProvider interface, NimEmbeddingProvider, MockEmbeddingProvider
│   │   ├── leases/
│   │   │   └── repositoryLeases.ts # Sync/embed lease claiming (FOR UPDATE SKIP LOCKED)
│   │   ├── llm/
│   │   │   └── llmProvider.ts  # LLMProvider interface + NIM implementation
│   │   ├── nvidia/
│   │   │   └── nvidiaModelService.ts # NVIDIA discovery, validation, and database cache
│   │   ├── mermaid/
│   │   │   ├── sanitizeMermaid.ts # DOMPurify SVG sanitizer
│   │   │   └── normalizeMermaid.ts # Edge-label quoting + stray `|>` repair
│   │   ├── rateLimit/
│   │   │   └── rateLimiter.ts  # Atomic Postgres transaction rate limiter
│   │   ├── retrieval/
│   │   │   ├── retriever.ts    # Cosine distance pgvector search + lexical full-text RRF
│   │   │   └── eval/
│   │   │       ├── dataset.ts         # 30-query curated evaluation dataset
│   │   │       ├── evaluator.ts       # Hit@K and MRR computation engine
│   │   │       ├── benchmarkCorpus.ts # Real chunk extraction from DRAG codebase
│   │   │       └── runEval.ts         # Evaluation comparison runner
│   │   └── ingestion/
│   │       ├── githubApiClient.ts     # Resilient GitHub Client (getTree size check)
│   │       ├── fileFilter.ts          # Ignored, secret, and sensitive file filters
│   │       ├── parserManager.ts       # LRU bounded Tree-sitter manager
│   │       ├── semanticChunker.ts     # Chunker splitting algorithms
│   │       ├── batchProcessor.ts      # Bounded batching + secret content skipping
│   │       └── dbLayer.ts             # Persistence logic (non-aborting, githubId keyed)
│   └── workflows/
│       ├── embed.ts            # Vercel Workflow: chunk + embed repository
│       ├── ingest.ts           # Vercel Workflow: acquire + parse + chunk
│       └── sync.ts             # Vercel Workflow: batch HEAD-SHA sync check
├── UI_CAPABILITIES.md          # Technical documentation and guide for the UI agent
└── HANDOFF.md                  # This file (single source of truth)
```

---

## 4. Database schema (v1.1)

All tables use `snakeCase.table` (except Better Auth baseline).

Migrations live in `src/db/migrations/`. All migrations through `20260927000000_privacy_plans_entitlements` (Phase 1 entitlements and privacy columns) and `20260927202821_nvidia_models` (Phase 2 model availability table) are verified and applied on the Neon database.

### `user`
Added plan and enterprise entitlement columns:
- `plan`: text ("free" | "hobby" | "enterprise"). Defaults to "free".
- `custom_repository_limit`: integer or null.
- `custom_monthly_query_limit`: integer or null.
- `custom_repository_size_bytes`: bigint or null.
- `custom_file_limit`: integer or null.
- `custom_allowed_branch`: text or null.
- `custom_incremental_reindex_allowed`: boolean or null.

### `repositories`
- `github_id`: bigint().unique(). Unique conflict target for repository upserts and transfer/rename tracking.
- `is_private`: boolean(). Server-verified GitHub visibility flag.
- `embedding_provider`: text ("gemini" | "cloudflare" | "nvidia").
- `embedding_model`: text.
- `embedding_dimensions`: integer.
- `next_sync_at`, `sync_status`, `sync_lease_expires_at`: sync status and lease tracking.
- `embedding_status`, `embedding_lease_expires_at`: embedding status and lease tracking.

### `chunks`
- `embedding`: custom vector(768) type for pgvector similarity search.
- `embedding_provider`: text ("gemini" | "cloudflare" | "nvidia").
- `embedding_model`: text.

### `user_repositories`
Join table representing user repository permissions. Unique on `(user_id, repository_id)`.

### `repository_access_cache`
Caches GitHub repository read checks. Stale after 1 hour (TTL: 3600000 ms). Unique on `(user_id, repository_id)`. When an association is removed via `DELETE /api/repos/[id]`, the cache entry is immediately invalidated.

### `conversations`
Tethers user thread contexts to repositories and user IDs.

### `messages`
Presents context threads. Status values: `pending | streaming | completed | failed`. Citations stored as JSONB metadata.

### `rate_limits`
Persistent Postgres rate limits to prevent serverless cold starts breaking checks. Operations run inside an atomic transaction using `SELECT ... FOR UPDATE` and upserts. Also tracks calendar month RAG query quotas with action `rag-monthly-quota`.

### `nvidia_models`
Stores validated NVIDIA chat model availability from weekly cron probe runs:
- `model_id`: text primary key.
- `status`: text ("available" | "unavailable").
- `latency_ms`: integer probe response time or null.
- `last_checked_at`: timestamp with timezone.
- `last_success_at`: timestamp with timezone or null.
- `last_error`: text or null.
- `created_at`, `updated_at`: timestamps with timezone.

---

## 5. Security and correctness hardening (v1.1)

1. **Workflow route protection**: `/api/workflows/embed`, `/api/workflows/sync`, and `/api/workflows/ingest-repository` require either valid user session authorization or internal cron authorization. Client-supplied GitHub auth tokens were removed from the request schema; tokens are retrieved strictly on the server using `auth.api.getAccessToken`.
2. **Sync lease atomicity**: `claimSyncBatch` runs the lock query (`SELECT ... FOR UPDATE SKIP LOCKED`) and the update query within an explicit database transaction.
3. **Ingestion fault-tolerance**: Parser failures and unreadable files log warnings and skip the individual file rather than aborting the workflow run.
4. **Ignored-diff HEAD advancement**: When a new commit contains only changes to ignored or non-indexed files, `headCommitSha` is advanced in the database before returning `skipped: true`.
5. **Repository re-index and retry**: `POST /api/repos` checks existing status. It starts ingestion for new repositories, prevents duplicate workflows for `ready` repositories, and allows retrying `failed` or stale lease repositories. `headCommitSha` is never written by the route, so a retry is never skipped by the workflow's unchanged-SHA check.
6. **Chat history deduplication and safety**: Prior conversation history is queried before inserting the current user message, preventing duplicates in the prompt. Prompts instruct the model that retrieved repository content is untrusted data. Retrieval or LLM failures mark the assistant message as `failed`.
7. **Mermaid rendering hardening**: Mermaid uses `securityLevel: "strict"` and `htmlLabels: false`, so labels are native SVG `<text>`. This is mandatory, not cosmetic: Mermaid's default labels are `<foreignObject>` HTML, DOMPurify drops `foreignObject` entirely, and every diagram rendered as unlabeled boxes. `sanitizeMermaidSvg` therefore keeps the SVG-only profile, and the two settings are coupled — flipping either alone breaks label rendering. Rendered SVGs are sanitized with DOMPurify using the SVG profile, stripping `<script>`, inline event handlers, and `javascript:` URLs. Chart text is normalized by `normalizeMermaid` before rendering, which quotes unquoted edge labels, drops the stray `|>` the model appends to a closing label pipe, and removes the model's `style`/`classDef`/`linkStyle` lines. Each diagram carries zoom (50–200%, reset) and a Code↔Diagram toggle plus a copy button, and a chart that fails to compile falls back to the source view with the parser message shown.
8. **One diagram look**: A single `THEME` in `MermaidBlock.tsx` sets `theme: "base"` with zinc surfaces (`#18181b` nodes, `#3f3f46` borders, `#71717a` edges, `#e4e4e7` text, `#0a0a0a` background) and one arrow style (`curve: "basis"`). Model-authored colors never survive normalization, so no diagram can reintroduce `#f9f`-style primaries. Do not reintroduce inline `style=` overrides in the block — they would fight the theme.
9. **Diagram sizing**: Mermaid emits `width="100%"` with an inline `max-width`, which shrinks wide charts into illegible thumbnails. `MermaidBlock` reads that `max-width` as the chart's natural width and applies it as a `min-width` floor, so wide diagrams scroll horizontally instead of collapsing. Zoom is CSS `zoom` on the wrapper (layout-aware, unlike `transform: scale`). A `width: auto` CSS override does **not** work here: it kills the sizing attribute and collapses the SVG to 0×0.
10. **Sensitive file and secret exclusion**: Ingestion excludes files matching `.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.der`, `.kdbx`, SSH keys, and credential JSON files. File contents matching private key headers (`-----BEGIN ... PRIVATE KEY-----` or `-----BEGIN CERTIFICATE-----`) are skipped with a warning.
11. **Multi-tenant isolation**: User conversations, repositories, and chunk retrieval strictly scope to authorized IDs. Forged IDs return 404 or 403.
12. **Cache invalidation policy**: `invalidateRepositoryAccessCache` invalidates cached access records upon repository removal. Permissions changed on GitHub expire naturally after the 1-hour TTL.
13. **Authenticated content is never cached on disk**: `GET /api/repos/[id]/file` returns private repository source with `Cache-Control: private, no-store`.
14. **No PII in the client bundle**: the BOSS plan banner in `PlanUsageModal.tsx` describes the tier without naming the administrator's email. Tier enforcement stays server-side in `entitlements.ts`.
15. **No secrets in URLs**: the Gemini API key is sent as an `x-goog-api-key` header so proxies, request logs, and fetch error traces cannot record it.
16. **Fail-closed entitlements and quota**: `checkRepositoryLimit` and `checkAndConsumeMonthlyQueryQuota` let database errors propagate so the route returns 5xx. No catch-all converts a failed count into "allowed".
17. **Workflow ingest route enforces the same policy as the UI route**: `POST /api/workflows/ingest-repository` resolves the plan branch (even when `revision` is omitted) and assigns it to the workflow payload, checks tree truncation, file count, and repository size via `assertPlanRepositoryEntitlements`, and creates the `repositories` row plus `user_repositories` association inside the limit-check transaction.

---

## 6. What is built

| Component | Status | Description |
|---|---|---|
| Ingestion and Embed Workflows | **DONE** | Full and incremental chunking, NIM embeddings, transaction batching. |
| Ingestion Fault-Tolerance | **DONE** | Missing or failed parse skips file and continues instead of aborting. |
| Durable Cron Sync | **DONE** | Atomic `claimSyncBatch` with `FOR UPDATE SKIP LOCKED` inside transactions. |
| DB Rate Limiter | **DONE** | Atomic Postgres transaction rate limiter protecting chat, repos, and workflows. |
| Bounded Parser Cache | **DONE** | Capped at 16 languages with LRU eviction. |
| Retrieval Module | **DONE** | Cosine similarity pgvector top-K retriever strictly scoped by repository ID. |
| Streaming Chat API | **DONE** | `/api/chat` streams response, updates message status, prevents duplication, and persists citations. |
| Inline Access Verification | **DONE** | Access cache verification with 1-hour TTL and explicit invalidation. |
| Workspace Dashboard UI | **DONE** | Modular SPA with responsive desktop sidebar, mobile drawer, threads, and code drawer. |
| Citation Code Viewer | **DONE** | Code preview drawer with line gutters, syntax highlighting, verified GitHub links, Esc keyboard dismissal, and fallback for unavailable sources. |
| Hardened Mermaid Renderer | **DONE** | Client-side strict Mermaid execution with DOMPurify SVG sanitization and `normalizeMermaid` edge-label repair. |
| Mermaid Edge-Label Parse Repair | **DONE** | `normalizeMermaid.ts` quotes unquoted `\|label\|` edge labels before rendering. Fixes the `got 'LINK_ID'` parse failure when the model emits a label starting with `@` or containing parentheses. Anchored on the link token so node text and `erDiagram` cardinality are untouched. Covered by `normalizeMermaid.test.ts`, which asserts against Mermaid's own parser. |
| Mermaid Stray `\|>` Parse Repair | **DONE** | `normalizeMermaid.ts` also drops a `\|>` the model appends to a closing label pipe (`A -->\|"HTTP Requests"\|> B` → `A -->\|"HTTP Requests"\| B`). `\|>` is a stateDiagram transition token, not a flowchart link, and caused `Expecting ... got 'TAGEND'` on every labelled edge, blanking whole architecture diagrams. Applied after quoting, so quoted and unquoted typos both resolve. Covered by `normalizeMermaid.test.ts` using the real failing chart. |
| Mermaid Diagram / Code Toggle | **DONE** | `MermaidBlock.tsx` renders a header with a Code↔Diagram toggle and a copy button (shared `CopyCodeButton.tsx`, extracted from `MessageRenderer.tsx`). On compile failure it stays on the source view and shows the parser message instead of a silent bare `<pre>`. Covered by `mermaidUi.test.tsx`. |
| Mermaid Label Visibility | **DONE** | Fixed invisible labels: Mermaid's default `<foreignObject>` HTML labels are stripped by DOMPurify, so every chart rendered as unlabeled boxes. `MermaidBlock` now initializes with `htmlLabels: false` for native SVG `<text>`. Verified in-browser (node and happy-dom both fail to reproduce Mermaid rendering, so this class of bug needs a real browser check). |
| Diagram House Theme | **DONE** | Model `style`/`classDef`/`linkStyle` lines are stripped in `normalizeMermaid`, and one `THEME` (`theme: "base"`, zinc surfaces, `curve: "basis"`) in `MermaidBlock.tsx` renders every chart identically. Kills the `#f9f`/`#ff0`/`#0f0` primary fills the model emitted, which also made light fills collide with the dark UI. |
| Diagram Zoom and Sizing | **DONE** | Natural width (Mermaid's inline `max-width`) is applied as a `min-width` floor so wide charts scroll instead of collapsing to thumbnails, plus 50–200% zoom with reset in the block header via CSS `zoom`. Verified in-browser at 100% and 200%. |
| Markdown Message Pipeline | **DONE** | GitHub-Flavored Markdown via react-markdown, remark-gfm, and syntax code blocks. |
| Secret and Sensitive Filtering | **DONE** | Rejects sensitive file extensions, credential names, and private key headers. |
| Canonical Lease Management | **DONE** | Consolidated lease queries in repositoryLeases.ts used by workflows and cron. |
| Shared Chunk Persistence | **DONE** | Shared batching and persistence helper in dbLayer.ts for full and incremental ingestion. |
| Swappable Embedding Provider | **DONE** | EmbeddingProvider interface with NimEmbeddingProvider and MockEmbeddingProvider. |
| Retrieval Evaluation Suite | **DONE** | 30-query curated benchmark with Hit@1, Hit@3, Hit@5, MRR, categorized reporting, and regression thresholds (`npm run eval:retrieval`). |
| Hybrid Code Retrieval | **DONE** | Vector similarity + PostgreSQL lexical search fused via Reciprocal Rank Fusion (RRF). |
| Bounded Context Assembly | **DONE** | Deduplicates chunks by ID and overlapping line ranges with bounded token assembly in `contextAssembler.ts`. |
| Prompt & Citation Quality | **DONE** | Refined system prompt in `conversation.ts` distinguishing verified code facts from inferences, enforcing citation precision without spam, and expanding retrieval topK to 8 for multi-file coverage. |
| End-to-End RAG Evaluation | **DONE** | 37-case benchmark evaluating retrieval separately from answer generation (`npm run eval:e2e`). Evaluates groundedness, factual correctness, citation correctness, insufficient-evidence handling, and multi-file reasoning. |
| Chat Failure & Stream Recovery | **DONE** | Explicit failure states, retry handler without user prompt duplication, partial text preservation, and file-level indexing transparency. |
| Correlated RAG Observability | **DONE** | Server-side single-line JSON structured logger (`logger.ts`) tracking correlated `traceId` across embedding, retrieval, and streaming, measuring `contextCharCount`, `citationsCount`, and `retrievalStrategy`. |
| Repository Metadata Transparency | **DONE** | Surface verified repository branch, language, commit SHA, and sync status in `ChatWindow.tsx` and `/api/repos/[id]/status`. |
| Chat Interaction Quality | **DONE** | Smart auto-scroll in `MessageList.tsx` avoiding scroll jumps while reading, and seamless status synchronization across repository switching. |
| Conversation Management | **DONE** | Authenticated rename and delete operations via `PATCH` and `DELETE /api/conversations/[id]`, inline UI controls, and cascading message deletion. |
| Workspace Keyboard Shortcuts | **DONE** | Global `Ctrl/Cmd + K` focusing repository filter, `Esc` closing overlays, `Enter` sending chat prompts, and `Shift + Enter` inserting newlines. |
| Security Regression Audit | **DONE** | Automated test suite (`regressionAudit.test.ts`) verifying workflow auth, repo auth, conversation auth, rate limits, message size caps, GitHub token isolation, tenant boundaries, and Mermaid SVG sanitization. |
| Deployment & Secret Hardening | **DONE** | Zero-secret client bundle (`clientEnv.ts`), comprehensive `.env.example`, `CRON_SECRET` validation, and deployment env verification test (`deploymentEnv.test.ts`). |
| Database Lifecycle Safety | **DONE** | Automated lifecycle test suite (`lifecycleSafety.test.ts`) verifying foreign key cascade deletes, user association cleanup cascading user conversations and messages, and unique index constraints. |
| Failure Recovery & Bounded Delays | **DONE** | GitHub API client bounds `Retry-After` delays to `maxDelayMs` (10s) to prevent unbounded serverless execution hangs, with verified automated backoff and retry. |
| Chat Retry Idempotency | **DONE** | `/api/chat` and UI support `isRetry` and `retryMessageId`, eliminating duplicate user messages in history, deleting failed assistant entries, and preventing prompt duplication in LLM payloads. |
| Load & Concurrency Benchmark | **DONE** | Controlled benchmark script (`runLoadTest.ts` via `npm run eval:load`) measuring hybrid retrieval P50/P95 latencies under 1, 5, 10, and 20 concurrency levels, parser throughput (~3,000 chunks/s), and memory stability. |
| Observability Secret Scrubber | **DONE** | Structured server logger (`logger.ts`) features an automated recursive secret scrubber redacting tokens, keys, passwords, and private key headers from log payloads. |
| Held-Out RAG Evaluation | **DONE** | 5-case un-tuned held-out test suite integrated into `npm run eval:e2e` verifying zero prompt overfitting, grounded answer generation, and accurate refusal on negative cases. |
| Production Launch Documentation | **DONE** | Launch-ready `README.md` documenting architecture, local setup, deployment steps, environment variables, test commands, and explicit operational limitations. |
| GitHub Access-Mode Selection & Enforcement | **DONE** | Pre-OAuth selection of Public-only (minimum scopes: `public_repo`, `read:user`) vs Full repository access (`repo`, `read:org`), server-side enforcement on `/api/repos` and `/api/workflows/ingest-repository` rejecting private repos in public mode with 403, and fresh OAuth upgrade consent flow. |
| Account Plans & Entitlements Subsystem | **DONE** | Free, Hobby, and Enterprise plans with server-side limit checks on repository count, monthly query quota, file count, repository size, main-only branch, and incremental reindex eligibility. |
| Privacy-Aware Embedding Architecture | **DONE** | Google Gemini (gemini-embedding-2, 768 dims) for public repos, Cloudflare Workers AI (@cf/qwen/qwen3-embedding-0.6b, 768 dims via Matryoshka truncation + L2 normalization) for private repos. Strict zero-fallback to Gemini on Cloudflare failure. Vector space isolation during retrieval. |
| Plans & Usage Workspace UI | **DONE** | Free (₹0), Hobby (₹499/month), Enterprise (₹15,000*/month) plan cards, usage progress bars for repositories and monthly RAG queries, upgrade modals, and plan limit error messages. |
| Repository Policy & Privacy Transparency | **DONE** | Dynamic repository policy limits displayed in `AddRepoModal.tsx`, server-provided privacy badges in `RepoList.tsx`, and indexing privacy disclosures. |
| NVIDIA Model Availability API & Selector | **DONE** | `GET /api/nvidia-models` serves persisted usable models without live probes. Workspace model selector integrates verified models with latency chips alongside the default LLM. |
| Conversation Search | **DONE** | Filter conversations by title or keyword in `ConversationList.tsx` with dedicated empty state and clear button. Small dataset filtering without unnecessary backend calls. |
| Dynamic Ingestion Progress | **DONE** | Multi-stage honest ingestion progress tracker (`preparing` -> `indexing` -> `embedding` -> `ready` or `failed`) derived from indexed files, chunks, and embedding lease status without fabricated percentages. |
| Repository Storage Display | **DONE** | Total indexed repository size aggregated from `repository_files.size_bytes`, served via `/api/repos/[id]/status` and rendered in `ChatWindow.tsx` and `RepoList.tsx`. |
| Relative Sync Timestamps | **DONE** | Human-readable relative timestamps ("just now", "X minutes ago", "X hours ago", "yesterday", "X days ago") calculated from `indexedAt`. |
| Conversation Response Modes | **DONE** | Client control in `Composer.tsx` for "Concise", "Deep", and "Simple" modes with explanatory tooltips, validated on the server in `POST /api/chat`, and injected into LLM system prompts without creating a second prompting system. |
| Citation File Download | **DONE** | Secure file download action in `CitationDrawer.tsx` backed by `GET /api/repos/[id]/file` with database association checks, live GitHub access checks, directory traversal blocks, and sensitive file filtering. |
| Branch Selection for Hobby and Enterprise | **DONE** | Server-enforced branch selection for Hobby, Enterprise, and Boss users. Free plan locked to `main`. Exact indexed commit SHA persisted. Safe default `main` preserved when unconfigured. |
| BOSS Administrator Plan | **DONE** | Special infinite tier with unlimited repositories, unmetered queries, unlimited storage and files, and any branch allowed (`*`). Exclusively locked and server-enforced for `yrovnit47@gmail.com` and `yravnit`. |
| Add Repository Flow Redesign | **DONE** | Displays authenticated GitHub repositories first, auto-populates repository URL and default branch on selection, fetches live branches via `/api/github/branches`, hides limit card for Boss tier, and provides a single Add button with ingestion progress handoff. |
| Ingestion Skip Validation Fix | **DONE** | Ingestion skip check in `ingest.ts` requires existing records to have a valid `indexedAt` timestamp and ready embedding status before skipping on matching commit SHA, preventing un-indexed records from skipping parse and chunk generation. |
| Resilient Embedding & Quota Recovery | **DONE** | Gemini embedding provider adds slice pacing, rate limit error parsing, and exponential backoff retry on HTTP 429 and 503. Repositories route sets null embedding lease on retry, and ingestion clears stale lease timestamps before triggering embedding workflow. |
| CodeRabbit Review Remediation | **DONE** | 23 findings verified and actioned: fail-closed quota and repository limits, shared-repository branch policy enforced on both add routes, no `headCommitSha` before ingestion, atomic quota rollback, first-time Free ingestion unblocked, multi-user sync entitlement, NVIDIA stale-model retirement, no secrets/PII in URLs or the client bundle. See section 10. |
| Multi-Provider NIM LLM Filtering & Reasoning Probing | **DONE** | Hardened non-chat filtering to omit translation (riva), calibration (ising), detectors, and clip models. Broadened candidate discovery to include all LLM providers hosted on NIM (Meta, OpenAI, Poolside, NVIDIA). Enhanced probe validation and streaming to support reasoning tokens (`reasoning_content`). |
| Interaction Feedback Pass | **DONE** | Every clickable surface now shows state: `active:` press scale on all buttons and cards, hover deltas raised on the near-black palette (zinc-950/40 → zinc-900), teal border + ring on selected repo/chat/picker cards, and hover-only affordances (delete, arrow hint) revealed on touch as well. Cards in `RepoList`, `ConversationList`, `GitHubRepoPicker`, and the landing access-mode selector are keyboard operable (`role="button"`, `tabIndex`, Enter/Space, `aria-current`/`aria-pressed`). |
| In-App Destructive Confirmation | **DONE** | `window.confirm` is gone. `ConfirmDialog.tsx` is a shared Esc-dismissible, focus-on-open alertdialog used by delete chat thread and remove repository. |
| Async Action Feedback | **DONE** | Delete chat, delete repository, retry indexing, and start conversation now disable the control, show a spinner, and surface a failure message instead of silently doing nothing. `page.tsx` handlers throw on non-OK responses so the components can render the error. |
| Modal Dismissal | **DONE** | `AddRepoModal` and `PlanUsageModal` close on `Esc` and backdrop click (skipped while an add is in flight). `CitationDrawer` already handled `Esc`. |
| Branch Fetch Throttling | **DONE** | `AddRepoModal` dedupes `/api/github/branches` per `owner/repo` via `lastBranchFetch`, so typing a URL no longer fires one GitHub API call per keystroke. |
| Thinking Line Indicator & Shimmer Animation | **DONE** | Model reasoning output (<think>, <thought>, reasoning_content, or chain-of-thought transitions) is parsed into a single clean line named "Thinking" with a continuous linear shimmer text animation (`thinking-linear-shimmer`), expandable on click. |
| Plan Card Pricing & Badge Polish | **DONE** | Enterprise card removes "Starting from" and adds asterisk (₹15,000*/month) with custom pricing note; removed sparkle logo preceding Hobby tier name. |
| Citation Marker Click Fix | **DONE** | Root cause of "clicking a citation does nothing": `MessageRenderer.tsx` only converted `[n]` markers that were bare strings directly inside a paragraph. A citation written inside a list item, table cell, heading, or blockquote rendered as inert text, and those are exactly where the model cites. `withCitations` now recurses through nested inline elements and is applied to `p`, `h1`–`h3`, `li`, `blockquote`, `th`, and `td`, so every marker renders a button that opens `CitationDrawer` with the syntax-highlighted snippet. Covered by `citationClick.test.tsx` (jsdom click assertions). |
| Per-Message Sources List | **DONE** | `MessageBubble.tsx` renders a "Sources" chip row of every retrieved citation (`file.ts` + line range) below each assistant answer, each chip opening the same drawer. Guarantees the cited files are reachable even when the model omits inline markers. |
| Two-Font Type System | **DONE** | Manrope for all body and UI text, Nohemi for every heading (h1–h4 plus the DRAG wordmark) via one `globals.css` rule and a `font-display` utility, Fira Code for code, snippets, line numbers, and mono chips with `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` fallback. Geist and the old `Arial, Helvetica` body stack are gone; `MermaidBlock` diagram labels follow `--font-manrope`. Nohemi is self-hosted at `src/app/fonts/nohemi/*.woff2` (converted from the author's free OTF release, free for commercial use, weights 400/500/600/700) because it is not a Google Font. |
| Fastest-Model Default | **DONE** | `ModelSelector.tsx` preselects the verified model with the lowest probe `latency_ms` from `GET /api/nvidia-models` as the default selection. A manual pick always wins (`manuallyPicked` ref), and when no model reports a latency the configured default LLM stays selected. Covered by `modelSelectorDefault.test.tsx`. |

---

## 7. Account plans and privacy-aware embedding architecture

### Account plans

DRAG implements tiered account plans. All limits are enforced server-side before running expensive ingestion, embedding, or LLM generation work. Client-supplied plan or limit values are ignored.

| Plan | Price | Repositories | Monthly queries | Max size | Max files | Branch | Incremental reindexing |
|---|---|---|---|---|---|---|---|
| **Free** | ₹0 | 2 | 25 / calendar month | 50 MB | 2,500 | `main` only | Disabled |
| **Hobby** | ₹499/month | 10 | Configurable (`HOBBY_MONTHLY_QUERY_LIMIT`, default 250) | 250 MB | 12,500 | Any (`*`) | Enabled |
| **Enterprise** | ₹15,000*/month | Configurable per user | Configurable per user | Configurable | Configurable | Configured entitlement (`main` safe default) | Configurable |
| **BOSS** | ₹0 (Exclusive) | Unlimited | Unmetered (null) | Unlimited | Unlimited | Any (`*`) | Enabled |

Enterprise plans support custom negotiated limits stored on the user row without hardcoding static enterprise constraints. The BOSS plan is strictly reserved and enforced server-side for user email `yrovnit47@gmail.com` and GitHub username `yravnit`. Unauthorized attempts to spoof or set the BOSS plan in the database fall back to the Free plan.

### Monthly query quota

Monthly query quota operates separately from temporary rate limits. Successful RAG requests consume one query from the monthly quota. Listing repositories, checking status, polling, and ingestion do not consume monthly query quota.

The monthly quota counter lives in the `rate_limits` table with `action = "rag-monthly-quota"`. Quota checks run inside PostgreSQL transactions using `SELECT ... FOR UPDATE` row locks to prevent race conditions from concurrent requests. A rejected request returns HTTP 429 and does not call embeddings or the LLM. If an upstream error occurs before streaming the assistant response, the transaction rolls back the consumed query.

Quota enforcement **fails closed**: any database, lock, or transaction error propagates to the route, which returns 5xx. It never degrades to `allowed: true`. Rollback is a single `GREATEST(count - 1, 0)` SQL statement rather than a read-modify-write, so a concurrent consumption can never be erased. Rollback is skipped entirely for unmetered plans (`monthlyQueryLimit === null`) because nothing was consumed.

### Repository limits and branch policy

Repository counts count both public and private repositories toward the plan limit. `checkRepositoryLimit` locks the user record with `SELECT ... FOR UPDATE` and counts associations. Callers pass a **transaction client** so the lock is held across the `user_repositories` insert: `POST /api/repos` and `POST /api/workflows/ingest-repository` run the limit check and the association insert inside one `db.transaction`, then start the ingestion workflow only after that transaction commits. `checkRepositoryLimit` therefore must not open its own transaction when handed a transaction client. The limit check runs after the GitHub lookups (it needs the repository id to exempt an existing association), so the add-repository rate limit (10 per 10 minutes) is what bounds wasted GitHub calls.

The Free plan requires the `main` branch. Repositories on Free without a `main` branch fail with an explicit HTTP 400 error. Hobby, Enterprise, and Boss tiers allow custom branches.

`repositories` rows are shared across users and keyed by `github_id`. The indexed branch therefore belongs to every associated user: `POST /api/repos` returns **409** when the requested branch differs from `existing.defaultBranch` instead of silently serving another branch's content or overwriting the branch other users depend on. (Keying indexed rows by `(github_id, branch)` is the eventual upgrade path and needs a migration.)

`POST /api/repos` never writes `headCommitSha`. Only the ingestion pipeline records it (`upsertRepository`, `saveIncrementalChunks`, or `updateHeadCommitSha` on the ignored-diff path). Writing it at add time would trip the workflow's unchanged-SHA skip and leave the repository permanently at `embeddingStatus: "processing"` with no chunks.

Incremental reindexing is blocked on the Free plan and permitted on the Hobby plan. The check in `src/workflows/ingest.ts` is gated on prior indexing (a non-empty tracked-files map): `POST /api/repos` creates the `repositories` row before starting the workflow, so `existingRepo` is always set on the very first ingest. `sync.ts` and the ingest fallback evaluate **all** `user_repositories` associations and allow the sync when at least one associated user is entitled, passing that user id as `userId` to `ingestRepository`. Picking an arbitrary associated user would stall a shared repository for its paying users.

### Privacy-aware embedding architecture

Embedding provider selection runs entirely on the server based on verified repository visibility:

- **Public repositories**: Google Gemini (`gemini-embedding-2`, 768 dimensions requested via `outputDimensionality: 768`). The API key travels in the `x-goog-api-key` header, never in the request URL.
- **Private repositories**: Cloudflare Workers AI (`@cf/qwen/qwen3-embedding-0.6b`, 768 dimensions via Matryoshka truncation and L2 normalization).

Server-verified visibility always wins over stored provenance in `getEmbeddingProviderForRepository`: a repository that is now private always resolves to Cloudflare, even if `embedding_provider` still reads `gemini` from before the visibility flip. Public repositories honour recorded provenance so query embeddings stay in the same space as the indexed chunks.

> **Follow-up (not blocking)**: `upsertRepository` updates `is_private` but leaves `embedding_provider` untouched, so chunks indexed as Gemini survive a public → private flip. The leak is closed (private always goes to Cloudflare), but retrieval will return no matches until the repository is re-ingested. Clearing `chunks.embedding` and the embedding fields when visibility flips would self-heal.

### Zero Gemini fallback invariant

Private repositories must never send source code to Gemini. If Cloudflare Workers AI fails or returns an error, the operation throws an error and fails immediately. The system never falls back to Gemini for private repository ingestion or chat queries.

### Embedding space consistency

Query embeddings match the embedding space of the target repository. Ingestion records `embedding_provider`, `embedding_model`, and `embedding_dimensions` on repository and chunk rows. The vector retriever filters chunks by matching `embedding_provider` to guarantee vectors from different spaces are never mixed during similarity search. A failed repository provider lookup propagates as an error instead of dropping the filter — silently mixing embedding spaces is worse than failing the request.

Cloudflare Workers AI responses are validated: Matryoshka truncation can only reduce dimensions, so a vector shorter than the target dimension throws rather than being written into the `vector(768)` column.

### Privacy disclosures

Public repository:
> **Public repository code may be used by third-party services to improve their products.**

Private repository:
> **Private repo chats don't expose your code to public-repository AI providers.**

### Plans and usage interface

DRAG surfaces plan pricing, usage meters, and policies in the workspace:

- **Plan tiers**: Free (₹0), Hobby (₹499/month), and Enterprise (₹15,000*/month, *Contact sales for custom pricing).
- **Usage display**: Repository count (`X / Y`) and calendar month RAG queries (`X / Y this month`) reflect live server entitlements from `GET /api/user/plan`.
- **Policy enforcement**: Ingestion size, file count, `main` branch constraints, and incremental reindexing support are surfaced directly inside `AddRepoModal.tsx`.
- **User-facing errors**: Clear plan messages ("Repository limit reached. Upgrade to Hobby to add more repositories." or "You've reached your monthly RAG query limit.") replace raw server errors when limits are reached.
- **Repository privacy indicators**: `RepoList.tsx` displays server-provided labels ("Public repo · Gemini embeddings" or "Private repo · Protected embedding") rather than browser assumptions.

### NVIDIA dynamic model availability monitor

DRAG monitors NVIDIA LLM availability automatically without manual model lists.

- **Weekly discovery**: A weekly Vercel cron job calls `GET https://integrate.api.nvidia.com/v1/models` using `NVIDIA_API_KEY`. The discovery request is bounded by a 10 s `AbortSignal.timeout` so a stalled upstream cannot hang the cron run.
- **Candidate filtering**: Selects valid namespaced models (`org/model-name`) hosted on the platform and filters out non-chat models (embedding, rerank, parse, guard, safety, reward, translation/riva, calibration/ising, detector, clip, deplot, diffusion).
- **Inference probing**: Probes each candidate with a chat completion request (`Reply with exactly: OK`) with 20 s timeout and 16 max tokens. Supports reasoning models that output tokens in `reasoning_content` with null `content` (such as Nemotron 3 Super 120B).
- **Stale retirement**: After a successful probe round, every row still marked `available` whose `model_id` was not in the current candidate set is flipped to `unavailable` with `last_error = "No longer listed by NVIDIA discovery"`. Without this, a model NVIDIA drops from `/v1/models` stays listed to clients forever and every chat request to it fails.
- **Fault isolation**: Probes run in concurrent batches. A single failing model does not fail the batch or entire job. If discovery fails completely, the database preserves the last known valid state.
- **Persistence**: Probe status, latencies, check timestamps, and errors are stored in `nvidia_models` in PostgreSQL.
- **Cached API**: `GET /api/nvidia-models` reads persisted usable models directly from PostgreSQL without triggering live probes on user requests. Database read failures are rethrown so the route returns 500 — clients must be able to tell "no verified models" from "read failed".
- **Workspace integration**: `ModelSelector.tsx` displays verified models across providers with clean names, full namespaces, and latency chips alongside the default model. If a model becomes unavailable, the current selection is retained without unexpected switching.

---

## 8. Out of scope (never implement)

- Cross-repo chatting.
- PR and Git history search.
- PDF and Word document parsing.

---

## 9. Tooling: tests, lint, and build

- **Tests**. 58 vitest files, 527 tests passing under `src/**/__tests__/`. Run with `npm test`.
- **Retrieval Eval**. `npm run eval:retrieval` runs baseline vs. hybrid evaluation benchmark with regression thresholds (Hit@1: 66.7%, Hit@5: 83.3%, MRR: 0.7150).
- **End-to-End RAG Eval**. `npm run eval:e2e` runs full answer-quality evaluation across 37 curated cases and 5 un-tuned held-out cases.
- **Load Benchmark**. `npm run eval:load` benchmarks concurrent retrieval latencies, parser throughput, and memory deltas.
- **Lint**. `npm run lint` (eslint) and `npm run lint:ox` (oxlint) both exit with code 0.
- **Type check**. `npx tsc --noEmit` exits with code 0.
- **Build**. `npm run build` succeeds using Next.js 16 and Turbopack.
- **CI**. `.github/workflows/ci.yml` runs `npm ci`, lint, lint:ox, `tsc --noEmit`, `npm test`, and `next build` on every push and PR.

*Last updated: 2026-10-03, citation marker click fix across list items/tables/headings, per-message Sources chips, Manrope + Nohemi + Fira Code type system, fastest-model default in the picker (527 tests green)*

---

## 10. CodeRabbit review remediation register (2026-10-02)

Every finding was verified against the code before being actioned. Severity labels are the
reviewer's; the outcome column is ours.

| # | Severity | Location | Outcome |
|---|---|---|---|
| 1 | minor | `nvidiaModelService.ts` DB read returned an empty list | **FIXED** — rethrown; route 500 is now reachable |
| 2 | minor | `retriever.ts` swallowed the provider lookup error | **FIXED** — removed; mocks updated |
| 3 | minor | `cloudflareEmbeddingProvider.ts` accepted short vectors | **FIXED** — throws when `rawVector.length < targetDimensions` |
| 4 | major | `dbLayer.ts` visibility flip left a stale `gemini` provider | **FIXED** — `router.ts` now checks `isPrivate` first; duplicate `resolveEmbeddingProvider` deleted. Stale chunks after a flip are logged as follow-up |
| 5 | major | `nvidiaModelService.ts` never retired vanished models | **FIXED** — `notInArray` retirement pass after a successful probe round |
| 6 | minor | `geminiEmbeddingProvider.ts` key in URL | **FIXED** — `x-goog-api-key` header |
| 7 | minor | `repos/[id]/file/route.ts` cache header | **FIXED** — `private, no-store` |
| 8 | minor | `formatters.ts` sub-KB formatting | **NOT APPLICABLE** — already fixed at `formatters.ts:9`; tests pass |
| 9 | major | `PlanUsageModal.tsx` hardcoded personal email | **FIXED** — email removed from copy |
| 10 | major | `enterpriseBranchUi.test.tsx` asserted the email | **FIXED** — replaced with an explicit `not.toContain` assertion |
| 11 | minor | `phase1UxCompletion.test.tsx` expected `"512 B"` | **NOT APPLICABLE** — passes against current `formatBytes` |
| 12 | minor | `nvidiaModelService.ts` discovery fetch had no timeout | **FIXED** — `AbortSignal.timeout(10_000)` |
| 13 | major | `repos/route.ts` pre-check blocked retries | **FIXED** — pre-check deleted; the transactional check after the GitHub lookups exempts existing associations |
| 14 | critical | `ingest.ts` incremental check blocked first-time Free ingestion | **FIXED** — gated on a non-empty tracked-files map |
| 15 | major | `repos/route.ts` shared-row branch overwrite / silent reuse | **FIXED** — 409 on branch mismatch |
| 16 | major | `ingest-repository/route.ts` skipped branch/file/size policy and never associated the user | **FIXED** — resolved branch assigned to the payload, `assertPlanRepositoryEntitlements` applied, association created in the limit-check transaction |
| 17 | major | `entitlements.ts` quota enforcement failed open | **FIXED** — catch-alls and the non-transactional fallback removed |
| 18 | critical | `repos/route.ts` wrote `headCommitSha` before ingestion | **FIXED** — route persists only `defaultBranch`; the pipeline records the SHA |
| 19 | major | `chat/route.ts` did not roll back on throw, and rolled back unmetered plans | **FIXED** — rollback on throw, gated on `quotaResult.limit !== null` |
| 20 | major | `sync.ts` used one arbitrary associated user | **FIXED** — all associations evaluated, entitled user id forwarded to `ingestRepository` |
| 21 | major | `entitlements.ts` rollback lost concurrent updates | **FIXED** — single `GREATEST(count - 1, 0)` statement |
| 22 | minor | `planConfig.ts` Hobby unmetered when env unset | **FIXED** — `HOBBY_MONTHLY_QUERY_LIMIT` defaults to 250 |
| 23 | major | `entitlements.ts` repository-limit lock released before the insert | **FIXED** — check and association insert share one transaction in both add routes |



