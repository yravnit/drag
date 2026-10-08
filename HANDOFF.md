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
│   ├── app/
│   ├── layout.tsx              # Root layout (Manrope, Nohemi, Fira Code fonts, dark theme)
│   ├── fonts/nohemi/           # Self-hosted Nohemi woff2 (400/500/600/700), display type only
│   ├── page.tsx                # Thin coordinator for workspace state
│   ├── globals.css             # Font tokens: --font-sans/display/mono (Nohemi is display-size only)
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
│   │       ├── MermaidBlock.tsx   # DOMPurify-sanitized client Mermaid diagrams, code toggle, copy, stream loader
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
│   │   │   ├── embeddingProvider.ts # EmbeddingProvider interface and shared option types
│   │   │   ├── geminiEmbeddingProvider.ts # Public repositories (gemini-embedding-2, 768d)
│   │   │   ├── cloudflareEmbeddingProvider.ts # Private repositories (Workers AI, Matryoshka + L2)
│   │   │   └── router.ts       # getEmbeddingProviderForRepository: visibility-based selection
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
│   │   │   └── rateLimiter.ts  # consumeCounter: atomic upsert rate limiter (no read-then-write)
│   │   ├── retrieval/
│   │   │   ├── retriever.ts    # Cosine distance pgvector search + lexical full-text
│   │   │   ├── fusion.ts       # RRF fusion, no DB import (shared by retriever + benchmark)
│   │   │   └── eval/
│   │       │       ├── dataset.ts         # 29-query curated evaluation dataset
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
└── HANDOFF.md                  # This file (single source of truth)
```

---

## 4. Database schema (v1.1)

All tables use `snakeCase.table` (except Better Auth baseline).

Migrations live in `src/db/migrations/`. Verified and applied on Neon: `20260927000000_privacy_plans_entitlements` (Phase 1 entitlements and privacy columns), `20260927202821_nvidia_models` (Phase 2 model availability table), and `20261006161125_messages_status_check`.

> **PENDING**: `20261006205902_violet_moonstone` adds `repositories.embedding_claim_id`. Generated and committed, **not yet applied**. Run `npm run db:migrate` (or `npm run db:push`) before deploying, or embedding final writes will fail on the missing column.

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
- `embedding_provider`: text. Only `"gemini"` and `"cloudflare"` are ever written; the union is fixed in `router.ts:54`. `NimEmbeddingProvider` exists in `embeddingProvider.ts` but is not on the production path.
- `embedding_model`: text.
- `embedding_dimensions`: integer.
- `next_sync_at`, `sync_status`, `sync_lease_expires_at`: sync status and lease tracking.
- `embedding_status`, `embedding_lease_expires_at`: embedding status and lease tracking.
- `embedding_claim_id`: text. Identifies the worker holding the embedding lease. A full run's provider pacing can exceed the 10-minute lease, so renew and final writes are scoped to a matching claim id rather than trusting the lease alone. Migration `20261006205902_violet_moonstone` (**generated, NOT yet applied to Neon** — run `npm run db:migrate` or `npm run db:push`).
- `default_branch`: text. The indexed branch, shared by every associated user because rows are keyed by `github_id`.
- `head_commit_sha`: text. Written only by the ingestion pipeline, never by the add-repository routes.
- `indexed_at`: timestamp with timezone. Drives the relative timestamps in the UI.

### `chunks`
- `embedding`: custom vector(768) type for pgvector similarity search.
- `embedding_provider`: text. Same `"gemini" | "cloudflare"` union as `repositories`; the retriever filters on it so vectors from different spaces are never mixed.
- `embedding_model`: text.

### `repository_files`
Per-file hash tracking, one row per indexed file. Backs incremental reindexing and the storage total in the UI.
- `id`, `repository_id` (FK, cascade delete), `file_path`, `content_hash`, `size_bytes`.
- `indexed_at`: timestamp with timezone. Incremental ingest skips a file only when this is set and embedding status is ready.
- `created_at`, `updated_at`: timestamps with timezone.
- Unique on `(repository_id, file_path)` via `repo_files_repo_id_file_path_idx`.
- `size_bytes` is summed for the "Repository Storage Display" figure served by `/api/repos/[id]/status`.

### `user_repositories`
Join table representing user repository permissions. Unique on `(user_id, repository_id)`.

### `repository_access_cache`
Caches GitHub repository read checks. Stale after 1 hour (TTL: 3600000 ms). Unique on `(user_id, repository_id)`. When an association is removed via `DELETE /api/repos/[id]`, the cache entry is immediately invalidated.

### `conversations`
Tethers user thread contexts to repositories and user IDs.

### `messages`
Presents context threads. `status` is constrained by `messages_status_check` to `pending | streaming | completed | failed` (migration `20261006161125_messages_status_check`, applied to Neon), and the column is `$type<MessageStatus>()` so a bad literal is also a compile error. Citations stored as JSONB metadata.

### `rate_limits`
Persistent Postgres rate limits to prevent serverless cold starts breaking checks. Also tracks calendar month RAG query quotas with action `rag-monthly-quota`.

**One atomic upsert, not read-then-write.** `consumeCounter` in `src/lib/rateLimit/rateLimiter.ts` is a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`. The previous shape was `SELECT ... FOR UPDATE` followed by a separate insert: `FOR UPDATE` locks nothing when the row does not exist yet, so every concurrent first request of a window saw no row and each conflicting insert reset `count` to 1. Requests were undercounted and both `checkRateLimit` and `checkAndConsumeMonthlyQueryQuota` allowed work past their limits. `checkAndConsumeMonthlyQueryQuota` delegates to the same function, so there is one counter implementation, not two.

**Rejections are guarded out, not clamped.** Two Postgres facts drive the shape, and getting either wrong is a bug:

1. `RETURNING` evaluates against the *updated* row. Clamping `count` at `maxRequests` inside `ON CONFLICT DO UPDATE` and then testing `count < maxRequests` in the same statement meant the last available slot both incremented the counter *and* read as `25 < 25` → rejected, so a Free user got 24 of their 25 monthly queries.
2. `ON CONFLICT DO UPDATE ... WHERE <false>` performs no update and returns no row.

So the update carries `setWhere = (window expired OR count < maxRequests)`. A request that finds the counter full writes nothing and gets no row back, which is `allowed: false`. The stored count therefore counts **consumed units only** and never inflates on rejection. That matters in three places: `getPlanUsage` reads the column directly, and `rollbackMonthlyQueryQuota` decrements it — with an attempt counter, one rejected request would swallow a real refund and permanently lose a slot. A rejected call reports `count: maxRequests` and the caller's own `windowEnd`, so `Retry-After` is an upper bound on the stored window's end rather than too short.

**A non-positive cap is rejected before the statement.** `consumeCounter` returns `allowed: false` when `maxRequests <= 0`, without touching the database. That cap is the one limit the statement cannot express: the `INSERT` (a counter's first request) has no guard at all, and the guard's expired-window branch passes regardless of `maxRequests`, so both write paths return a row. An Enterprise account with `custom_monthly_query_limit = 0` (a real value — `0` means zero queries, only `null` is unmetered) was therefore granted exactly one query whenever its counter was created or its month rolled over. The guard lives in `consumeCounter` rather than in `checkAndConsumeMonthlyQueryQuota`, so every current and future caller is covered.

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
3. **Ingestion fault-tolerance**: Parser failures and unreadable files log warnings and skip the individual file rather than aborting the workflow run. Unreadable *directories* are handled the same way: `traverse` in `fileFilter.ts` catches `readdir` failures and skips that subtree, because `discoverRepositoryFiles` has no per-directory recovery and a single throw there would abort the whole run.
4. **Ignored-diff HEAD advancement**: When a new commit contains only changes to ignored or non-indexed files, `headCommitSha` is advanced in the database before returning `skipped: true`.
5. **Repository re-index and retry**: `POST /api/repos` checks existing status. It starts ingestion for new repositories, prevents duplicate workflows for `ready` repositories, and allows retrying `failed` or stale lease repositories. `headCommitSha` is never written by the route, so a retry is never skipped by the workflow's unchanged-SHA check.
6. **Chat history deduplication and safety**: Prior conversation history is queried before inserting the current user message, preventing duplicates in the prompt. Prompts instruct the model that retrieved repository content is untrusted data. Retrieval or LLM failures mark the assistant message as `failed`.
7. **Mermaid rendering hardening**: Mermaid uses `securityLevel: "strict"` and `htmlLabels: false`, so labels are native SVG `<text>`. This is mandatory, not cosmetic: Mermaid's default labels are `<foreignObject>` HTML, DOMPurify drops `foreignObject` entirely, and every diagram rendered as unlabeled boxes. `sanitizeMermaidSvg` therefore keeps the SVG-only profile, and the two settings are coupled — flipping either alone breaks label rendering. Rendered SVGs are sanitized with DOMPurify using the SVG profile, stripping `<script>`, inline event handlers, and `javascript:` URLs. Chart text is normalized by `normalizeMermaid` before rendering, which quotes unquoted edge labels, drops the stray `|>` the model appends to a closing label pipe, and removes the model's `style`/`classDef`/`linkStyle` lines. Each diagram carries zoom (50–200%, reset) and a Code↔Diagram toggle plus a copy button, and a chart that fails to compile falls back to the source view with the parser message shown.
8. **One diagram look**: A `THEME` in `MermaidBlock.tsx` sets `theme: "base"` with zinc surfaces (`#18181b` nodes, `#3f3f46` borders, `#71717a` edges, `#e4e4e7` text, `#0a0a0a` background); the arrow style `curve: "basis"` lives in a separate `flowchart` object, so it applies to flowchart diagrams only. Model-authored colors never survive normalization: `normalizeMermaid` strips line-anchored `style` / `classDef` / `linkStyle`, **plus `%%{init: {...}}%%` directives and leading YAML frontmatter**. The latter two matter because Mermaid merges directive and frontmatter config *over* the config from `initialize()`, and its sanitizer keeps any key that is valid config — so `theme`, `themeVariables`, and `htmlLabels` all survive, and `themeVariables` values are not colour-checked. Without stripping them, model output reinstates the `#f9f` primaries and the `htmlLabels` default that blank every label. Do not reintroduce inline `style=` overrides in the block — they would fight the theme.
9. **Diagram sizing**: Mermaid emits `width="100%"` with an inline `max-width`, which shrinks wide charts into illegible thumbnails. `MermaidBlock` reads that `max-width` as the chart's natural width and applies it as a `min-width` floor, so wide diagrams scroll horizontally instead of collapsing. Zoom is CSS `zoom` on the wrapper (layout-aware, unlike `transform: scale`). A `width: auto` CSS override does **not** work here: it kills the sizing attribute and collapses the SVG to 0×0.
10. **Sensitive file and secret exclusion**: Ingestion excludes files matching `.env*`, `.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.cer`, `.der`, `.kdbx`, SSH keys, and credential JSON files. File contents matching private key headers (`-----BEGIN ... PRIVATE KEY-----` or `-----BEGIN CERTIFICATE-----`) are skipped with a warning.
11. **Multi-tenant isolation**: User conversations, repositories, and chunk retrieval strictly scope to authorized IDs. Forged IDs return 404 or 403.
12. **Cache invalidation policy**: `invalidateRepositoryAccessCache` invalidates cached access records upon repository removal. Permissions changed on GitHub expire naturally after the 1-hour TTL.
13. **Authenticated content is never cached on disk**: `GET /api/repos/[id]/file` returns private repository source with `Cache-Control: private, no-store`.
14. **No PII in the client bundle**: the BOSS plan banner in `PlanUsageModal.tsx` describes the tier without naming the administrator's email. Tier enforcement stays server-side in `entitlements.ts`.
15. **No secrets in URLs**: the Gemini API key is sent as an `x-goog-api-key` header so proxies, request logs, and fetch error traces cannot record it.
16. **Fail-closed entitlements and quota**: `checkRepositoryLimit` and `checkAndConsumeMonthlyQueryQuota` let database errors propagate so the route returns 5xx. No catch-all converts a failed count into "allowed".
17. **Retry deletes are tenant-scoped**: `POST /api/chat` deletes the `retryMessageId` row only when it matches the caller's `conversationId`, `role = 'assistant'`, and `status = 'failed'`. The id is client-supplied, so an id-only filter let any authenticated user erase another conversation's message.
18. **Counters are created and incremented in one statement**: see the `rate_limits` section. Any new counter must go through `consumeCounter`; do not reintroduce a `SELECT … FOR UPDATE` followed by an insert.
19. **Repository attach and detach share a row lock, and creation is transactional**: `DELETE /api/repos/[id]` takes `SELECT … FOR UPDATE` on the `repositories` row, then deletes the association, recounts, and only then deletes the row — all in one transaction. `POST /api/repos` takes the same lock inside its limit-check transaction and creates the row there too. Counting first and deleting afterwards let another user attach the repository in between, and the cascade then took that association, its index, and its conversations with it; inserting the row before the limit check left unowned `processing` rows that sync would pick up.
20. **Verified visibility is always persisted on every write path**: `POST /api/repos` writes `isPrivate` whenever it differs from the stored value, not only on rename or transfer, and `saveIncrementalChunks` in `dbLayer.ts` writes it on the incremental path too (the incremental twin of `upsertRepository`, which already did). A repo that flips public → private without a rename previously kept `isPrivate = false`, so `runEmbedBatch` chose Gemini and sent private source to it. (The separate stale-vectors-in-the-wrong-space problem is still open — see the follow-up in section 7.)
21. **Legacy rows are adopted by URL; recycled URLs are freed, never reused, and a URL row that is already this repository is reused as-is**: rows created before `github_id` existed have it null, so the github-id lookup misses them and the insert then failed on the unique URL. A URL row with `githubId IS NULL` is genuinely the same repository: it is adopted and its id backfilled. The whole decision — lookup, id comparison and write — runs inside one transaction that takes `SELECT … FOR UPDATE` on the URL row, because two users adding the same repository at once each miss the github-id lookup and then find the *other* request's just-committed row by URL. **A URL row whose `githubId` equals the incoming id is therefore reused, not freed**: treating it as recycled rewrote the URL of a perfectly good row and left that write committed, while the insert then failed on the unique `githubId` and 500ed. The lock matters because the loser of a race re-reads the row under `FOR UPDATE` and so sees the winner's committed `github_id`. A URL row carrying a *different* non-null id **is** a different repository at a recycled URL (private repo deleted, public one created at the same path). Reusing it would swap the row's GitHub ID while keeping the old private source's chunks and `ready` status, so the new repository would be answered from the previous owner's code. It must still be freed from the unique `url` column or the new insert raises a constraint violation, so the route rewrites **only the old row's `url`** to `<url>#stale-<githubId>`. Its `github_id`, chunks, conversations and associations are untouched and it stays reachable by `github_id`, which is how sync, ingestion and access checks all find it. Cost: Retry on that row now fails URL parsing, which it would anyway since GitHub no longer serves it at that path. Residual: two *brand-new* adds that find no row at all still race on the unique `github_id`, and the loser 500s. Pre-existing, unchanged by the lock above, and cheap to retry rather than to code around. The test pins the lock **to the query that took it**, not to the lock strength: each `repositories` select in `route.test.ts` is tagged with its ordinal and the URL-fallback lock is asserted as `{ lookup: 2, strength: "update" }`, so the attach transaction's own `FOR UPDATE` on lookup 3 cannot stand in for it. Deleting the URL lookup's `.for("update")` fails the test.
22. **Retry re-embeds instead of re-ingesting**: when a repository is `failed` or has a stale lease *and* still has chunks without embeddings, ingestion already succeeded, so `POST /api/repos` starts `embedRepository` directly. Re-running ingestion was rejected outright for Free users with tracked files and returned `skipped` for unchanged files, leaving recovery to the daily cron.
23. **Embedding runs are claim-owned**: `claimEmbeddingLease` returns a claim id stored in `repositories.embedding_claim_id`. `embedRepository` renews the lease before each batch and calls `finalizeEmbedding` / `clearEmbeddingLease` with the claim id; a lost claim returns early rather than writing. A full run's Gemini pacing alone can exceed the 10-minute lease, so the lease alone is not proof of ownership.
24. **Sync drains its due queue**: `syncRepositories` loops `claimSyncBatchStep` until a batch comes back short (`MAX_BATCHES_PER_RUN = 20`). Claiming one batch of five and returning left everything beyond the first five unchecked until the next daily run.
25. **Client state is request-scoped, per load, and rejected before touching loading state**: `page.tsx` keeps **two** monotonic request ids, one for conversations and one for messages, and both stream loops check the message id before writing. A single shared counter let the repository effect's `setSelectedConversation(null)` run the message effect and invalidate the conversation load it had just started, so the response was discarded and `convsLoading` never cleared. `loadMessages` and `loadConversations` bail out at the *top* of the function when their id is already stale, because a superseded stream completion otherwise raised `messagesLoading` and discarded its own response, stranding the current thread's spinner forever. Covered by `src/app/__tests__/workspaceRequestScope.test.tsx`.
26. **Local temp ids never reach the server as ids**: a failed first request reloads messages from the server instead of leaving a `temp-a-*` bubble, and `handleRetryMessage` omits `retryMessageId` for unsaved messages. A `temp-*` id is not a UUID, so the delete query failed on invalid input before generation ever started. Retry also sends `repo.defaultBranch`, since the server otherwise defaults to `main` and 409s on a repository indexed on another branch.
27. **Status is fetched once per selection**: the status effect fetches on mount for every selected repository and polls only while the status is non-terminal. It previously returned early for `ready` repositories, and `/api/repos` does not return storage, file/chunk counts, or the commit SHA, so those displays stayed empty after a reload.
28. **Mermaid diagram ids are content-derived**: `chartDomId` hashes the chart source, so re-rendering a message keeps the same id and `MermaidBlock` does not clear and re-render a finished diagram. The markdown component map is memoized. A per-render `Math.random()` id made every streamed token restart every diagram.
29. **The E2E benchmark cannot read its own answer key**: `generateDeterministicRagResponse` takes only the query and the retrieved chunks. It previously interpolated `requiredFacts` into the answer and chose refusal from `evidenceType`, and the evaluator then checked those same facts, so every case passed by construction. The report now states that it measures retrieval and evaluator agreement only, not the prompt or the model.
30. **The benchmark shares production ranking code**: fusion lives in `src/lib/retrieval/fusion.ts` (no database import) and both the retriever and the benchmark call it. `searchLexicalBaseline` now assigns one tier per chunk from `LEXICAL_TIER`, mirroring the `CASE` in `retrieveChunksLexical`, instead of accumulating path and per-term scores. A copied or divergent implementation let a change that worsened real search keep the CI score unchanged.
31. **Workflow ingest route enforces the same policy as the UI route**: `POST /api/workflows/ingest-repository` resolves the plan branch (even when `revision` is omitted) and assigns it to the workflow payload, checks tree truncation, file count, and repository size via `assertPlanRepositoryEntitlements`, and creates the `repositories` row plus `user_repositories` association inside the limit-check transaction. It also enforces the shared-repository branch guard: `repositories` rows are keyed by `github_id` and shared across users, so a request for a branch other than the existing `default_branch` is rejected with **409** rather than re-indexing the shared row and serving another branch's code to every other associated user. Covered by `ingest-repository/__tests__/route.test.ts`.
32. **The chat prompt must never quote the phrasing it forbids**: the answer prompt in `conversation.ts` deliberately carries no blacklist of banned openings, because naming them is what produced them — the model sees the forbidden wording adjacent to the question and echoes it back. State the wanted behaviour instead ("your opening sentence responds to the question"), and never let the prompt refer to its own input as a "retrieved context". `buildSystemPrompt.test.ts` fails if any forbidden opening reappears in the prompt text. Verify new prompt rules against a live model before keeping them: of the four rules tried in this round, one had to be reverted outright and another reshaped, because a rule telling the model to name the source as "the repository or the code" made the leak *worse* by licensing a trailing "in the provided code" inside the opening sentence.

---

## 6. What is built

| Component | Status | Description |
|---|---|---|
| Ingestion and Embed Workflows | **DONE** | Full and incremental chunking, privacy-selected embeddings (Gemini for public, Cloudflare for private), transaction batching. |
| Ingestion Fault-Tolerance | **DONE** | Missing or failed parse skips file and continues instead of aborting. |
| Durable Cron Sync | **DONE** | Atomic `claimSyncBatch` with `FOR UPDATE SKIP LOCKED` inside transactions. The daily run **drains** its due queue (loops until a batch comes back short, `MAX_BATCHES_PER_RUN = 20`) instead of checking only the first five. |
| DB Rate Limiter | **DONE** | `consumeCounter`: a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count` protecting chat, repos, and workflows, and backing the monthly quota. One statement, so a user's first request of a window cannot race. A non-positive cap is rejected before the statement, because neither the unguarded INSERT nor the expired-window branch of the guard can express "zero allowed". See section 4. |
| Bounded Parser Cache | **DONE** | Capped at `MAX_CACHED_LANGUAGES = 16` with true LRU eviction: a cache hit re-inserts its key so the first insertion-order key is the coldest. Only 13 source languages exist, so the cap is not reached in practice. |
| Retrieval Module | **DONE** | Cosine similarity pgvector top-K retriever strictly scoped by repository ID. |
| Streaming Chat API | **DONE** | `/api/chat` streams response, updates message status, prevents duplication, and persists citations. |
| Inline Access Verification | **DONE** | Access cache verification with 1-hour TTL and explicit invalidation. |
| Workspace Dashboard UI | **DONE** | Modular SPA with responsive desktop sidebar, mobile drawer, threads, and code drawer. |
| Citation Code Viewer | **DONE** | Code preview drawer with line gutters, syntax highlighting, verified GitHub links, Esc keyboard dismissal, and fallback for unavailable sources. |
| Hardened Mermaid Renderer | **DONE** | Client-side strict Mermaid execution with DOMPurify SVG sanitization and `normalizeMermaid` edge-label repair. |
| Mermaid Edge-Label Parse Repair | **DONE** | `normalizeMermaid.ts` quotes unquoted `\|label\|` edge labels before rendering. Fixes the `got 'LINK_ID'` parse failure when the model emits a label starting with `@` or containing parentheses. Anchored on the link token so node text and `erDiagram` cardinality are untouched. Covered by `normalizeMermaid.test.ts`, which asserts against Mermaid's own parser. |
| Mermaid Stray `\|>` Parse Repair | **DONE** | `normalizeMermaid.ts` also drops a `\|>` the model appends to a closing label pipe (`A -->\|"HTTP Requests"\|> B` → `A -->\|"HTTP Requests"\| B`). `\|>` is a stateDiagram transition token, not a flowchart link, and caused `Expecting ... got 'TAGEND'` on every labelled edge, blanking whole architecture diagrams. Applied after quoting, so quoted and unquoted typos both resolve. Covered by `normalizeMermaid.test.ts` using the real failing chart. |
| Mermaid Diagram / Code Toggle | **DONE** | `MermaidBlock.tsx` renders a header with a Code↔Diagram toggle and a copy button (shared `CopyCodeButton.tsx`, extracted from `MessageRenderer.tsx`). On compile failure it stays on the source view and shows the parser message instead of a silent bare `<pre>`. Covered by `mermaidUi.test.tsx`. |
| Mermaid Stable Diagram Identity | **DONE** | `chartDomId` derives a diagram's DOM id from a hash of its own source, scoped by `useId()` per message, and the markdown component map is memoized with a hoisted plugin array. A per-render `Math.random()` id was a new `MermaidBlock` dependency on every streamed token and page-state update, so it cleared and re-rendered finished diagrams: visible flicker plus repeated Mermaid work. Covered by `mermaidStableId.test.tsx` (re-render keeps one id; two diagrams in a message get distinct ids). Reviewed again in rounds 4 and 5 and re-confirmed unchanged — a report of "every render generates a new Mermaid ID" is describing the pre-round-2 code, not this file. |
| Mermaid Label Visibility | **DONE** | Fixed invisible labels: Mermaid's default `<foreignObject>` HTML labels are stripped by DOMPurify, so every chart rendered as unlabeled boxes. `MermaidBlock` now initializes with `htmlLabels: false` for native SVG `<text>`. Verified in-browser (node and happy-dom both fail to reproduce Mermaid rendering, so this class of bug needs a real browser check). |
| Diagram House Theme | **DONE** | Model `style`/`classDef`/`linkStyle` lines are stripped in `normalizeMermaid`, and one `THEME` (`theme: "base"`, zinc surfaces, `curve: "basis"`) in `MermaidBlock.tsx` renders every chart identically. Kills the `#f9f`/`#ff0`/`#0f0` primary fills the model emitted, which also made light fills collide with the dark UI. |
| Diagram Zoom and Sizing | **DONE** | Natural width (Mermaid's inline `max-width`) is applied as a `min-width` floor so wide charts scroll instead of collapsing to thumbnails, plus 50–200% zoom with reset in the block header via CSS `zoom`. Verified in-browser at 100% and 200%. |
| Mermaid Streaming Loader | **DONE** | `MermaidBlock` takes a `streaming` prop (wired from `MessageRenderer`'s `isStreaming`) and skips the render effect entirely while true, holding a centered `min-h-[10rem]` spinner with a "waiting for diagram…" label. A half-streamed fence is not valid Mermaid, so rendering it flashed a broken diagram and then the source plus an amber parse-error banner. `isStreaming` is in the `components` memo deps because `code` closes over it; it flips once per turn, so the cost is at most one extra markdown subtree remount per message. Covered by `mermaidUi.test.tsx`. |
| Markdown Message Pipeline | **DONE** | GitHub-Flavored Markdown via react-markdown, remark-gfm, and syntax code blocks. |
| Secret and Sensitive Filtering | **DONE** | Rejects sensitive file extensions, credential names, and private key headers. |
| Canonical Lease Management | **DONE** | Consolidated lease queries in repositoryLeases.ts used by workflows and cron. Embedding leases are **claim-owned**: `claimEmbeddingLease` returns a claim id stored in `repositories.embedding_claim_id`, `embedRepository` renews before each batch, and `finalizeEmbedding` / `clearEmbeddingLease` require a matching claim. A full run's provider pacing can exceed the 10-minute lease, so without the id a stale worker could clear or overwrite the run that replaced it. |
| Shared Chunk Persistence | **DONE** | Shared batching and persistence helper in dbLayer.ts for full and incremental ingestion. |
| Swappable Embedding Provider | **DONE** | `EmbeddingProvider` interface in `embeddingProvider.ts` with two implementations, `GeminiEmbeddingProvider` and `CloudflareEmbeddingProvider`, chosen per repository by `getEmbeddingProviderForRepository`. The dead `NimEmbeddingProvider` and `MockEmbeddingProvider` were deleted on 2026-10-06; `openai` stays as a dependency because `llmProvider.ts` uses it. |
| Retrieval Evaluation Suite | **DONE** | 29-query curated benchmark with Hit@1, Hit@3, Hit@5, MRR, categorized reporting, and enforced regression thresholds (`npm run eval:retrieval`, also run in CI). Current MRR 0.7149. **Shares production ranking code**: fusion is `src/lib/retrieval/fusion.ts` (no DB import) called by both the retriever and the benchmark, and the lexical baseline assigns one tier per chunk from `LEXICAL_TIER` to match the production SQL `CASE`. |
| Hybrid Code Retrieval | **DONE** | Vector similarity + PostgreSQL lexical search fused via Reciprocal Rank Fusion (RRF). |
| Bounded Context Assembly | **DONE** | Deduplicates chunks by ID and overlapping line ranges with a bounded character budget in `contextAssembler.ts`. The bound is `DEFAULT_MAX_TOTAL_CHARS = 24000` measured on raw string length, not tokens (no tokenizer is involved), so it is roughly 6-8k tokens of code. |
| Prompt & Citation Quality | **DONE** | The answer system prompt was extracted to an exported `buildSystemPrompt({ mode, evidence })` in `conversation.ts` and rewritten to stop the model opening with retrieval narration ("Based on the provided code context…"). **Root cause: the prompt named the phrases it forbade.** It said *"Do not open with lines like "Based on the provided code context", "It appears to be", …"* — a blacklist that injects the banned wording into the context window next to the question and invites the model to echo it. Compounding it, the prompt repeatedly framed its own input as *"the retrieved code context"* (four times) and defined an escape hatch phrased around the index (*"I cannot determine this from the indexed repository"*), teaching the model to narrate its inputs. The rewrite **describes the behaviour instead of quoting it** — "Answer first. Your opening sentence responds to the question that was asked. Do not open by describing the code you were given, summarising it, or stating how you will proceed" — so there is nothing to echo, and the evidence header is `Repository evidence:` rather than `Retrieved Code Context:`. Diagram rules are now explicit in all three directions: draw when asked, draw unprompted for genuinely sequential/relational answers, stay textual for single facts, and **do not** treat "architecture/flow/relationship/process/dependency" in the question as sufficient cause. Verified by live-model A/B against real Spring Pet Clinic evidence on `nvidia/nemotron-3-ultra-550b-a55b` and `openai/gpt-oss-20b`, both `generate()` and `stream()` paths, 8 questions. Leak on the old prompt: cases 3, 6, 8 plus the robotic refusal on 4 and 7. New prompt: **0 leaks across all 8**; diagrams appeared for the controller→DB flow and the Owner→Pet→Visit chain and stayed suppressed for the keyword-only pattern question. Two prompt iterations were measured and one was **reverted** — a rule telling the model to name the source as "the repository or the code" made things *worse*, licensing a trailing "in the provided code" inside the opening sentence. Residual, honest: on negative-finding answers the model still sometimes appends a justification clause ("The provided code shows…") *after* a correct, direct opening. Not fixed at the prompt level without post-processing, which is out of scope. Locked by `buildSystemPrompt.test.ts`, whose central assertion is that the prompt never contains the openings it is trying to prevent. |
| End-to-End RAG Evaluation | **DONE** | 37-case benchmark evaluating retrieval separately from answer generation (`npm run eval:e2e`). Reports groundedness, factual correctness, citation correctness, insufficient-evidence handling, and multi-file reasoning. **The generator reads only the query and retrieved chunks, never the expected facts** — it previously interpolated `requiredFacts` into the answer and picked refusal from `evidenceType`, so every case passed by construction. It measures retrieval and evaluator agreement, not the prompt or the model. **Multi-file success requires cited support from more than one expected file**; the previous `|| chunks.some(<one chunk matches any expected file>)` fallback awarded it from a single chunk, so the check immediately above it could never fail. Covered by `e2eGenerationLeakage.test.ts` and two `e2eEvaluator.test.ts` cases (one expected file cited; second expected file never retrieved). |
| Chat Failure & Stream Recovery | **DONE** | Explicit failure states, retry handler without user prompt duplication, partial text preservation, and file-level indexing transparency. A server-side failure reloads messages instead of keeping the local `temp-a-*` bubble, and retry omits `retryMessageId` for unsaved messages, so a non-UUID local id never reaches the delete query. |
| Request-Scoped Workspace State | **DONE** | `page.tsx` guards every async write with a monotonic request id: `loadMessages`, `loadConversations`, and both stream loops check it before applying, and a stream's completion reload targets the conversation it started for. Switching threads mid-response could otherwise land thread A's answer and citations under thread B. Status is fetched once per selection and polled only while non-terminal, so a ready repository shows storage, file/chunk counts, and the commit SHA after a reload. |
| Repository Recovery & Lifecycle Integrity | **DONE** | Verified `isPrivate` is persisted whenever it differs from the stored value; legacy rows with a null `github_id` are found by URL and backfilled; a URL row already carrying the incoming `github_id` is reused instead of having its URL freed (two users adding the same repository concurrently); a genuinely recycled URL is freed from the old row only, under a `SELECT … FOR UPDATE`; a `failed` repository that still has unembedded chunks restarts `embedRepository` directly rather than re-ingesting; retry sends the indexed branch; attach and detach share a `SELECT … FOR UPDATE` on the `repositories` row. |
| Correlated RAG Observability | **DONE** | Server-side single-line JSON structured logger (`logger.ts`) tracking correlated `traceId` across embedding, retrieval, and streaming, measuring `contextCharCount`, `citationsCount`, and `retrievalStrategy`. |
| Repository Metadata Transparency | **DONE** | Surface verified repository branch, language, commit SHA, and sync status in `ChatWindow.tsx` and `/api/repos/[id]/status`. |
| Chat Interaction Quality | **DONE** | Smart auto-scroll in `MessageList.tsx` avoiding scroll jumps while reading, and seamless status synchronization across repository switching. |
| Conversation Management | **DONE** | Authenticated rename and delete operations via `PATCH` and `DELETE /api/conversations/[id]`, inline UI controls, and cascading message deletion. |
| Workspace Keyboard Shortcuts | **DONE** | Global `Ctrl/Cmd + K` focusing repository filter, `Esc` closing overlays, `Enter` sending chat prompts, and `Shift + Enter` inserting newlines. |
| Security Regression Audit | **DONE** | Automated test suite (`regressionAudit.test.ts`) verifying message size caps, rate limits, GitHub token isolation, conversation authorization and tenant isolation, retriever repository-boundary scoping, cron auth, and Mermaid SVG sanitization. Workflow-route auth and repository-route auth are covered separately in `api/workflows/ingest-repository/__tests__/route.test.ts` and `api/repos/__tests__/route.test.ts`. |
| Deployment & Secret Hardening | **DONE** | Zero-secret client bundle (`clientEnv.ts`), comprehensive `.env.example`, `CRON_SECRET` validation, and deployment env verification test (`deploymentEnv.test.ts`). |
| Database Lifecycle Safety | **DONE** | Automated lifecycle test suite (`lifecycleSafety.test.ts`) verifying foreign key cascade deletes, user association cleanup cascading user conversations and messages, and unique index constraints. |
| Failure Recovery & Bounded Delays | **DONE** | GitHub API client bounds `Retry-After` delays to `maxDelayMs` (10s) to prevent unbounded serverless execution hangs, with verified automated backoff and retry. |
| Chat Retry Idempotency | **DONE** | `/api/chat` and UI support `isRetry` and `retryMessageId`, eliminating duplicate user messages in history, deleting failed assistant entries, and preventing prompt duplication in LLM payloads. |
| Load & Concurrency Benchmark | **DONE** | Controlled benchmark script (`runLoadTest.ts` via `npm run eval:load`) measuring R50/P95 latency under 1, 5, 10, and 20 concurrency levels, parser throughput, and memory stability. **The retrieval half is an in-memory RRF pass over a synthetic corpus (`benchmarkCorpus.ts`), not pgvector/Postgres** — those latencies measure ranking cost only and must not be read as database capacity numbers. Throughput is computed at runtime, not a fixed target. The report's closing section states what was and was not measured instead of printing fixed "observed" latency, safe-concurrency, and failure-point figures the harness never checked. |
| Observability Secret Scrubber | **DONE** | Structured server logger (`logger.ts`) features an automated recursive secret scrubber redacting tokens, keys, passwords, and private key headers from log payloads. |
| Held-Out RAG Evaluation | **DONE** | 5-case un-tuned held-out suite integrated into `npm run eval:e2e`, checking retrieval on queries that were not tuned against. Like the main set, generation is answer-key-free, so a held-out case can no longer report "correct" without the retrieved code actually supporting it. |
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
| Conversation Response Modes | **DONE** | Client control in `Composer.tsx` for "Concise", "Deep", and "Simple" modes with explanatory tooltips, validated on the server in `POST /api/chat`, and injected into LLM system prompts without creating a second prompting system. All three are **one sentence appended to the single answer prompt** (`buildSystemPrompt`'s `modeInstruction`), not separate prompts: `precise`→Concise, `detailed`→Deep, `explain_simply`→Simple. `POST /api/chat` coerces anything unrecognised to `precise` rather than rejecting, so an old client cannot break a send. Mode is per-message, not per-conversation: it rides the request body and is never persisted, so revisiting a thread replays the same mode it was answered in without storing it. It does not affect retrieval, embedding, topK, or citations — only answer style. |
| User Prompt Affordances & Message Limit | **DONE** | Long user prompts no longer push the thread out of view and can be copied. `MessageBubble.tsx` renders a `CopyCodeButton` under every user prompt — the existing code-block copy component, reused rather than a second implementation — copying the **full** `message.content` string, not the clamped rendering. A prompt over `COLLAPSE_OVER_CHARS` (280) is clamped with CSS `line-clamp-6` plus a Show more / Show less toggle carrying `aria-expanded`. Clamping is CSS-only, so there is no measuring pass per message; the toggle is user-prompt-only and assistant answers are never clamped. `line-clamp-6` must stay a **literal** — Tailwind scans for whole class names, so an interpolated `line-clamp-${n}` compiles to nothing (verified the rule is present in the production build: `.line-clamp-6{-webkit-line-clamp:6;...}`). The 4000-character cap that already existed only in `POST /api/chat` (where it surfaced as an opaque 400 after the fact) now also lives on the composer textarea as native `maxLength`, with a remaining-character counter that stays hidden until the last 10% and turns amber in the final 100. `MAX_CHAT_MESSAGE_LENGTH` moved to `types.ts` (which imports nothing, so both client and route read one constant and cannot drift); the server check stays as the backstop for a client that skips the attribute. Covered by `userPromptAffordances.test.tsx` (8 cases, jsdom + `createRoot`/`act`, matching the `citationClick.test.tsx` pattern — the repo has no `@testing-library/react`). |
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
| Async Action Feedback | **DONE** | Delete chat, delete repository, retry indexing, and start conversation now disable the control, show a spinner, and surface a failure message instead of silently doing nothing. `page.tsx` handlers throw on non-OK responses so the components can render the error, and the repository `ConfirmDialog` has its own `catch` + `error` prop: `RepoList`'s handler only opens the dialog, so a throw from `handleDeleteRepo` had nowhere to land and just stopped the spinner. |
| Modal Dismissal | **DONE** | `AddRepoModal` and `PlanUsageModal` close on `Esc` and backdrop click (skipped while an add is in flight). `CitationDrawer` already handled `Esc`. |
| Branch Fetch Throttling | **DONE** | `AddRepoModal` dedupes `/api/github/branches` per `owner/repo` via `lastBranchFetch`, so typing a URL no longer fires one GitHub API call per keystroke. |
| Thinking Line Indicator & Shimmer Animation | **DONE** | Model reasoning output (<think>, <thought>, reasoning_content, or chain-of-thought transitions) is parsed into a single clean line named "Thinking" with a continuous linear shimmer text animation (`thinking-linear-shimmer`), expandable on click. |
| Plan Card Pricing & Badge Polish | **DONE** | Enterprise card removes "Starting from" and adds asterisk (₹15,000*/month) with custom pricing note; removed sparkle logo preceding Hobby tier name. |
| Citation Marker Click Fix | **DONE** | Root cause of "clicking a citation does nothing": `MessageRenderer.tsx` only converted `[n]` markers that were bare strings directly inside a paragraph. A citation written inside a list item, table cell, heading, or blockquote rendered as inert text, and those are exactly where the model cites. `withCitations` now recurses through nested inline elements and is applied to `p`, `h1`–`h3`, `li`, `blockquote`, `th`, and `td`, so every marker renders a button that opens `CitationDrawer` with the syntax-highlighted snippet. Covered by `citationClick.test.tsx` (jsdom click assertions). |
| Per-Message Sources List | **DONE** | `MessageBubble.tsx` renders a "Sources" chip row of every retrieved citation (`file.ts` + line range) below each assistant answer, each chip opening the same drawer. Guarantees the cited files are reachable even when the model omits inline markers. |
| Two-Font Type System | **DONE** | Manrope for all body, UI and small-label text; Nohemi for display type **only where the rendered size is >= ~24px**, applied through the `font-display` utility alone; Fira Code for code, snippets, line numbers and mono chips with `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` fallback. Geist and the old `Arial, Helvetica` body stack are gone; `MermaidBlock` diagram labels follow `--font-manrope`. Nohemi is self-hosted at `src/app/fonts/nohemi/*.woff2` (converted from the author's free OTF release, free for commercial use, weights 400/500/600/700) because it is not a Google Font. **Nohemi must never be applied blanket to `h1`–`h4`**: it is display-only, its cap height is 7px at a 10px font-size and 11px at 48px versus Manrope's 11px at 10px, so below ~20px its strokes thin, its counters fill and its G reads visibly smaller than neighbouring letters. It also ships no 800 weight, so `font-extrabold` on Nohemi silently renders 700. The `--font-sans`/`--font-display` tokens carry a generic tail (`ui-sans-serif, system-ui, sans-serif`) because `@theme inline` substitutes the `var()` value verbatim and would otherwise strip it, leaving a failed webfont to fall through to the browser's default serif. |
| Fastest-Model Default | **DONE** | `ModelSelector.tsx` preselects the verified model with the lowest probe `latency_ms` from `GET /api/nvidia-models` as the default selection. A manual pick always wins (`manuallyPicked` ref), and when no model reports a latency the configured default LLM stays selected. Covered by `modelSelectorDefault.test.tsx`. |
| **BLOCKER — default `LLM_MODEL` is dead** | **OPEN** | The `LLM_MODEL` schema default is `minimaxai/minimax-m3` (`serverEnv.ts:31`), and that model reached end of life on 2026-09-09. NVIDIA now answers **410 Gone**: *"The model 'minimaxai/minimax-m3' has reached its end of life … and is no longer available."* It is also absent from `GET /v1/models`. `.env` does not set `LLM_MODEL`, so anything running without an explicit `LLM_MODEL` and without a model pick falls back to the corpse and every answer fails. `ModelSelector`'s fastest-model default masks this in the normal UI flow, which is why it went unnoticed. The account also returns **404 Not Found** for most catalog models (`llama-3.1-nemotron-*`, `mistral-large-2-instruct`, `nemotron-4-340b-instruct`, `llama-3.1-nemotron-ultra-253b-v1`) — verified available for this key are `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3.5-lightning-30b-a3b`, `openai/gpt-oss-20b`, `meta/llama-3.2-11b-vision-instruct`, `meta/muse-glimmer-30b`, `poolside/laguna-xs-2.1`. **Fix: change the `LLM_MODEL` default to a model the weekly probe confirms `available`**, and treat a provider 410 as a retire signal for that `modelId` rather than a transient error. Not fixed here — out of scope for the prompt work, and the right default depends on which models the account keeps access to. |
| Greptile Review Remediation (round 2) | **DONE** | 17 findings merged into 11 work areas: tenant-scoped retry delete, atomic counter upsert for both limiters, repository visibility / legacy-row fallback / embed-only retry in `POST /api/repos`, transactional detach with a shared row lock, sync drain, client request-id guards plus retry branch and status fetch, claim-owned embedding leases, E2E answer-key removal, shared fusion, README provider docs. See section 5 items 17-31. Migration `20261006205902_violet_moonstone` still needs applying to Neon. |
| PR Review Remediation (round 3) | **DONE** | 12 findings reviewed, 10 fixed (Issues 4 and 6 were the same sync-drain item, already implemented in round 2 and verified by `syncEntitlement.test.ts`): counter `allowed` off-by-one, per-load client request ids plus stale-rejection before loading state, URL fallback restricted to `github_id IS NULL`, incremental visibility persistence, quota rollback scoped to the consumed window, transactional repository creation, strict multi-file evaluator credit, honest load-test report, and repository-delete error surfaced in the dialog. See section 5 items 18-25 and 20-21. |
| PR Review Remediation (round 4) | **DONE** | 3 follow-up findings: the round-3 counter fix traded an under-grant for an inflated attempt count that swallowed quota refunds, so rejections are now guarded out via `ON CONFLICT DO UPDATE ... WHERE` (no row returned = rejected, nothing written) instead of over-incrementing; the `github_id IS NULL` URL restriction alone left the old row holding the unique `url` and 500'd the replacement add, so a recycled URL is freed on the old row alone; the Mermaid finding was stale (stable content-derived ids landed in round 2, covered by `mermaidStableId.test.tsx`). |
| PR Review Remediation (round 5) | **DONE** | 3 findings, 2 fixed: the URL fallback in `POST /api/repos` judged a row stale without comparing `github_id`, so two users adding the same repository concurrently had the winner's row rewritten to `#stale-…` (committed) and then 500 on the unique `github_id` — it now compares the ids, reuses a match, and takes `SELECT … FOR UPDATE` on the URL row in the same transaction; `consumeCounter` had no zero-cap guard, so an Enterprise account with `custom_monthly_query_limit = 0` was granted one query per month whenever its counter was created or the month rolled over — it now rejects `maxRequests <= 0` before writing. The third finding (per-render Mermaid ids) was stale again. See section 5 items 21 and section 4. |
| Chat Scroll Stability & Typing Performance | **DONE** | Three fixes. (1) `MessageList` pinned to the bottom with `scrollIntoView({behavior:"smooth"})` on every `messages` change; a stream replaces that array on every chunk, so the animation restarted per token and never settled, its target was measured before the content finished growing (overshooting the last line), it scrolled every scrollable ancestor, and Chrome freezes smooth scrolls in a backgrounded tab and resolves them against a stale target on refocus. Replaced with a single `requestAnimationFrame`-coalesced `container.scrollTop = container.scrollHeight`; the cancel-on-unmount effect is separate from the `[messages]` effect, since cancelling there would drop the pending frame each chunk and leave the list unpinned mid-stream. (2) `Composer` set `style.height = "auto"` then read `scrollHeight` per keystroke, forcing a synchronous document reflow per character and resizing the message list's box; now it grows natively via Tailwind's `[field-sizing:content]`. (3) `messageText` is top-level state, so each keystroke re-rendered the whole workspace; `Sidebar`, `MessageList`, `AddRepoModal`, `PlanUsageModal` and `CitationDrawer` are `memo`-wrapped and every callback reaching them is `useCallback`-stable in `page.tsx`/`WorkspaceShell.tsx` (without that, fresh inline arrows per render mean `memo` never hits). Covered by `messageListScrollPin.test.tsx`. The per-chunk `setMessagesList` in the stream loops was left alone: chunk rate is already under frame rate, so rAF coalescing would not help and throttling lower only makes the text choppier. |
| Sidebar No Longer Blanks On Refocus | **DONE** | Two causes. (1) `page.tsx` keyed the initial-load effect on the whole `session` object; Better Auth refetches the session when the window regains focus and returns a fresh identity for the same user, so alt-tabbing back re-ran the effect and flipped `reposLoading` on every time. Now keyed on `session?.user?.id`. (2) `RepoList`/`ConversationList` replaced their entire list with a spinner whenever `isLoading` was true, so any background refetch blanked the sidebar and popped it back. Both now gate on `isLoading && <list>.length === 0`, so a refresh never destroys visible content. |
| Model-Generated Conversation Titles | **DONE** | A brand new thread is named from its opening question instead of staying `Conversation N`. `conversation.ts` detects the first turn (no completed history, not a retry) and fires `titleConversation` **immediately**, before retrieval and before the answer stream exists, because the title only needs the question text and racing from t=0 means it finishes long before the answer rather than competing with it for the same wall clock. It is **awaited before the stream closes**, because a fire-and-forget write can be frozen on a serverless invocation that ends with the response. The model is asked for `{"title":"..."}` but is not trusted to emit it: `parseTitle` walks JSON → embedded JSON → a loose `"title":` regex → bare prose, refusing the prose path when the reply is JSON-shaped, then collapses whitespace, peels wrapping quotes and trailing punctuation to a fixed point and clips at a word boundary (max 60 chars). Failures are swallowed and never affect the answer. **The client needs no settling delay**: because the server awaits the title write before `controller.close()`, the title is already committed when the reader observes `done`, so `page.tsx` reloads conversations immediately (previously a blind 600ms `setTimeout` — cargo cult, since the guarantee already existed) and only when the user is still on that thread. The title only ever renders in the sidebar (`ConversationList` ← `conversationsList`); the chat header shows the repository name, not the thread name. Covered by `parseTitle.test.ts` (8 cases). The three failure-path assertions in `conversation.test.ts` select the failed update by `status` rather than array position, since the concurrent title write shares the same recorded-update list and can land after an early return. |
| Pricing Modal Contrast Pass | **DONE** | `PlanUsageModal` secondary copy was dim enough to be unreadable: `text-zinc-500` on near-black is ~4:1 at 12px, and several labels sat at `text-[10px]`/`text-[11px]`. Lifted one step (`zinc-500` → `zinc-400`, `zinc-400` → `zinc-300`, `zinc-300` → `zinc-200` on the BOSS banner) and floored real content at `text-xs`. Icon-button hover states keep `zinc-500`. |
| Fullscreen Legibility Sweep & Chrome Reduction | **DONE** | The repo metadata line under the title (`main · ec5eb4c · 60 files indexed · …`) and the equivalent line on each repo card were `text-[10px] font-mono text-zinc-500` — 4.2:1 and 4.0:1 against their backgrounds, **below the 4.5:1 WCAG AA floor for normal text**, and unreadable at fullscreen size. Both are now `text-xs text-zinc-400` in Manrope (7.9:1 and 7.6:1) with only the commit sha kept in mono, since it is a hash. The same `text-[10px] text-zinc-500` defect was swept out of the sidebar's bare dim labels (`v1.1 · Beta`, `Repositories`, `Chats`, the repo count, the user's email) and the indexing stage caption, all now `text-[11px]`/`text-xs` at `zinc-400`. Small type is deliberately kept only where it is a badge or keycap with its own background (`⌘K`, the privacy pill, `Full Access`, `₹499/mo`). The green "ready" dot is gone from both the repo list and the chat header: it was on for essentially every indexed repo and the header already states the state in words, so it carried no information — the amber indexing and red failure dots stay, as do their labels, because those need watching. Chunk counts are hidden from the chat header per product decision; they remain in the indexing progress tracker (`50 / 150 chunks`) where they are live progress feedback and two tests assert them. |

---

## 7. Account plans and privacy-aware embedding architecture

### Account plans

DRAG implements tiered account plans. All limits are enforced server-side before running expensive ingestion, embedding, or LLM generation work. Client-supplied plan or limit values are ignored.

| Plan | Price | Repositories | Monthly queries | Max size | Max files | Branch | Incremental reindexing |
|---|---|---|---|---|---|---|---|
| **Free** | ₹0 | 2 | 25 / calendar month | 50 MB | 2,500 | `main` only | Disabled |
| **Hobby** | ₹499/month | 10 | Configurable (`HOBBY_MONTHLY_QUERY_LIMIT`, default 250) | 250 MB | 12,500 | Any (`*`) | Enabled |
| **Enterprise** | ₹15,000*/month | 50 (configurable) | Unmetered (`null`, configurable) | 1 GB (configurable) | 50,000 (configurable) | `main` safe default (configurable) | Enabled (configurable) |
| **BOSS** | ₹0 (Exclusive) | Unlimited | Unmetered (null) | Unlimited | Unlimited | Any (`*`) | Enabled |

Enterprise plans support custom negotiated limits stored on the user row. The values above are `ENTERPRISE_DEFAULT_LIMITS` in `planConfig.ts:76-84` and apply to any enterprise user whose `custom_*` columns are null, so they are real enforced numbers rather than placeholders. The BOSS plan is strictly reserved and enforced server-side for user email `yrovnit47@gmail.com` and GitHub username `yravnit`. Unauthorized attempts to spoof or set the BOSS plan in the database fall back to the Free plan.

### Monthly query quota

Monthly query quota operates separately from temporary rate limits. Successful RAG requests consume one query from the monthly quota. Listing repositories, checking status, polling, and ingestion do not consume monthly query quota.

The monthly quota counter lives in the `rate_limits` table with `action = "rag-monthly-quota"`. Quota checks run inside PostgreSQL transactions using `SELECT ... FOR UPDATE` row locks to prevent race conditions from concurrent requests. A rejected request returns HTTP 429 and does not call embeddings or the LLM. If an upstream error occurs before streaming the assistant response, the transaction rolls back the consumed query.

Quota enforcement **fails closed**: any database, lock, or transaction error propagates to the route, which returns 5xx. It never degrades to `allowed: true`. Rollback is a single `GREATEST(count - 1, 0)` SQL statement rather than a read-modify-write, so a concurrent consumption can never be erased. Rollback is skipped entirely for unmetered plans (`monthlyQueryLimit === null`) because nothing was consumed.

`rollbackMonthlyQueryQuota` requires the **consumed window's** `windowEnd` (the `resetAt` returned by `checkAndConsumeMonthlyQueryQuota`) and matches it with `eq`. Filtering on `window_end > now` instead let a request that consumed just before midnight and failed just after decrement the *new* month's row, erasing usage recorded by a different month's requests.

### Repository limits and branch policy

Repository counts count both public and private repositories toward the plan limit. `checkRepositoryLimit` locks the user record with `SELECT ... FOR UPDATE` and counts associations. Callers pass a **transaction client** so the lock is held across the `user_repositories` insert: `POST /api/repos` and `POST /api/workflows/ingest-repository` run the limit check, the `repositories` insert, and the association insert inside one `db.transaction`, then start the ingestion workflow only after that transaction commits. `checkRepositoryLimit` therefore must not open its own transaction when handed a transaction client. The limit check runs after the GitHub lookups (it needs the repository id to exempt an existing association), so the add-repository rate limit (10 per 10 minutes) is what bounds wasted GitHub calls.

`POST /api/repos` creates the `repositories` row **inside** that transaction, not before it. Inserting first left an unowned `processing` row behind on every rejected request, and sync later claimed it as real work. A brand-new repository has no association to exempt, so the limit check is passed `existing?.id` (undefined when creating).

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

- **Tests**. 60 vitest files, 568 tests passing under `src/**/__tests__/`. Run with `npm test`.
- **Retrieval Eval**. `npm run eval:retrieval` runs the baseline vs. hybrid benchmark **with regression thresholds enforced** (the script passes `--check-thresholds`, so the command exits non-zero on a regression). Current: Hit@1 69.0%, Hit@3 72.4%, Hit@5 79.3%, MRR 0.7149 against `DEFAULT_RETRIEVAL_THRESHOLDS` of Hit@1 0.55 / Hit@3 0.65 / Hit@5 0.75 / MRR 0.60. Fully offline, so it also runs in CI. **The figures jumped on 2026-10-07 because the benchmark was fixed, not because search improved**: fusion now calls the production `fuseHybridResults` instead of a copy, and `searchLexicalBaseline` assigns one tier per chunk from `LEXICAL_TIER` exactly as the production SQL `CASE` does. The old accumulating score was a different ranking function, so the previous number measured that copy. Configuration-category Hit@1 is 0% — those queries ask for literal config values (for example a `4000` character cap) that the deterministic hash embedding cannot match; the lexical tiers carry them on Hit@3.
- **End-to-End RAG Eval**. `npm run eval:e2e` runs 37 curated cases and 5 un-tuned held-out cases. Answers are generated deterministically from the retrieved chunks, so it measures **retrieval quality and evaluator agreement only** — it does not exercise the chat system prompt or the LLM, and a live-model run is required for that. Current main-set answer scores are low (groundedness 0%, citation correctness ~24%); that is the honest reading after removing the answer-key leakage, not a regression. Treat retrieval Hit@K as the meaningful signal here.
- **Load Benchmark**. `npm run eval:load` benchmarks concurrent retrieval latencies, parser throughput, and memory deltas.
- **Lint**. `npm run lint` (eslint) and `npm run lint:ox` (oxlint) both exit with code 0.
- **Type check**. `npx tsc --noEmit` exits with code 0.
- **Build**. `npm run build` succeeds using Next.js 16 and Turbopack.
- **CI**. `.github/workflows/ci.yml` runs `npm ci`, lint, lint:ox, `tsc --noEmit`, `npm test`, `eval:retrieval`, and `next build` on every push and PR.
- **Format**. `npm run format:ox` is *not* enforced in CI and currently reports issues across the tree; treat it as advisory and format only the files you touch.
- **`npm ci` and lockfile consistency resolved.** `better-auth` is pinned to exact `1.6.24` in `package.json`, `.npmrc` sets `legacy-peer-deps=true` so npm cleanly resolves Drizzle ORM v1 pre-release peer dependencies, and `package-lock.json` was regenerated with `npm install --package-lock-only`. Both local `npm install` and CI `npm ci` pass without `ERESOLVE` or missing package warnings.
- **Ad-hoc dependency auditing.** Knip, dependency-cruiser, and vitest coverage were run once as throwaway `--no-save` installs to find dead code; none are project dependencies and none are wired into scripts or CI. See section 10 for the findings and what was removed.

*Last updated: 2026-10-08 (test hardening: `route.test.ts` records the querying `repositories` select alongside each row lock and asserts the URL fallback's lock by ordinal, so the attach transaction's `FOR UPDATE` can no longer make the concurrency assertion pass while the URL lookup is unlocked; verified by deleting the URL lookup's `.for("update")` and watching that one test fail. 568 tests green, `oxlint` clean. The earlier 2026-10-08 round-5 remediation: the URL fallback in `POST /api/repos` compares `github_id` under a row lock instead of freeing a matching row's URL, and `consumeCounter` rejects a non-positive cap before writing; `tsc --noEmit` and both linters clean. The prior 2026-10-06 pass had verified every section against the code: shared-repository branch guard on `/api/workflows/ingest-repository` (409), Mermaid `%%{init}` and frontmatter stripped, genuinely LRU parser cache, `eval:retrieval` thresholds enforced in CI, GitHub token-isolation test rewritten so it can fail, unreadable directories skip instead of aborting ingestion, and the drifted claims in sections 3-7, 9, and 10 corrected)*

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
| 15 | major | `repos/route.ts` shared-row branch overwrite / silent reuse | **FIXED** — 409 on branch mismatch. The same guard was ported to `ingest-repository/route.ts` on 2026-10-06, which had been missing it (see section 5 claim 17) |
| 16 | major | `ingest-repository/route.ts` skipped branch/file/size policy and never associated the user | **FIXED** — resolved branch assigned to the payload, `assertPlanRepositoryEntitlements` applied, association created in the limit-check transaction |
| 17 | major | `entitlements.ts` quota enforcement failed open | **FIXED** — catch-alls and the non-transactional fallback removed |
| 18 | critical | `repos/route.ts` wrote `headCommitSha` before ingestion | **FIXED** — route persists only `defaultBranch`; the pipeline records the SHA |
| 19 | major | `chat/route.ts` did not roll back on throw, and rolled back unmetered plans | **FIXED** — rollback on throw, gated on `quotaResult.limit !== null` |
| 20 | major | `sync.ts` used one arbitrary associated user | **FIXED** — all associations evaluated, entitled user id forwarded to `ingestRepository` |
| 21 | major | `entitlements.ts` rollback lost concurrent updates | **FIXED** — single `GREATEST(count - 1, 0)` statement |
| 22 | minor | `planConfig.ts` Hobby unmetered when env unset | **FIXED** — `HOBBY_MONTHLY_QUERY_LIMIT` defaults to 250 |
| 23 | major | `entitlements.ts` repository-limit lock released before the insert | **FIXED** — check and association insert share one transaction in both add routes |

### Follow-up findings from the 2026-10-06 verification pass

Found by auditing this document against the code rather than by review. All are fixed on `frontend`.

| # | Severity | Location | Outcome |
|---|---|---|---|
| 24 | critical | `ingest-repository/route.ts` had no shared-repository branch guard, unlike `repos/route.ts` | **FIXED** — a paying user could re-ingest a shared row on another branch and serve every other user the wrong code; now 409 |
| 25 | major | `normalizeMermaid.ts` stripped only line styling, not `%%{init}` or frontmatter | **FIXED** — both stripped; model output could otherwise override the theme and `htmlLabels` |
| 26 | major | `regressionAudit.test.ts` GitHub token-isolation assertion used a two-arg matcher against a one-arg call | **FIXED** — the assertion could never fail, and the fetcher was never invoked because `answerConversation` is mocked; the test now exercises the fetcher directly |
| 27 | minor | `runEval.ts` threshold gate unreachable from `npm run eval:retrieval` | **FIXED** — script passes `--check-thresholds` and CI runs it |
| 28 | minor | `parserManager.ts` eviction was FIFO despite the LRU comment | **FIXED** — a cache hit re-inserts its key |
| 29 | minor | `fileFilter.ts` `readdir` unguarded, so one unreadable directory aborted the whole ingestion run | **FIXED** — caught and skipped with a warning |
| 30 | minor | `messages.status` accepted any string; the four lifecycle values were convention only | **FIXED** — `messages_status_check` CHECK constraint plus `$type<MessageStatus>()`; migration `20261006161125_messages_status_check` is **applied to Neon** (ledger verified, all 18 existing rows were valid before the constraint was added) |
| 31 | cleanup | `NimEmbeddingProvider` and `MockEmbeddingProvider` were dead code, along with `config.ts`, `EMBEDDING_MODEL`, `EMBEDDING_BASE_URL`, and the NVIDIA embedding endpoint guard | **REMOVED** — `embeddingProvider.ts` now holds only the interface; `openai` stays for `llmProvider.ts`. Benchmark queries were repointed at the Gemini and Cloudflare providers |

---

## 11. Dead-code sweep (2026-10-06)

Found with one-off `--no-save` installs of **knip** 6.40.0, **dependency-cruiser** 18.5.0, and `vitest run --coverage`. Neither tool was added to `package.json`, `package-lock.json`, or any npm script; both were uninstalled afterwards. `vitest` and `@vitest/coverage-v8` were already project devDependencies.

### Removed

| Kind | Finding | Outcome |
|---|---|---|
| unused file | `src/lib/embeddings/index.ts` — a one-line `export * from "./embeddingProvider"` barrel with no importers | **DELETED** |
| circular dep | `embeddingProvider.ts:31-33` re-exported its own three siblings, so `router → provider → router` cycled. Left behind when the `index.ts` barrel was inlined | **REMOVED** — `embeddingProvider.ts` is now types-only. dependency-cruiser reports **0 cycles** |
| unused dep | `@types/tar` — `tar@7.5.21` ships its own `dist/commonjs/index.d.ts`, so the DefinitelyTyped stub was dead weight | **REMOVED** |
| unused devDep | `@types/dompurify` — `dompurify@3.2.4` ships its own `dist/purify.cjs.d.ts` | **REMOVED** |
| unlisted dep | `ignore` was imported by `fileFilter.ts` but only present as a transitive dev dependency of eslint, so production ingestion depended on hoisting by luck | **PROMOTED** to a direct `dependencies` entry at the already-resolved `^5.3.2` (no lockfile churn) |
| unused export | `authClient`, `signUp` (`auth/client.ts`) — only `signIn`/`signOut`/`useSession` are consumed | **DE-EXPORTED** |
| unused export | `SENSITIVE_EXTENSIONS`, `isProjectFile`, `SupportedSourceLanguage`, `ProjectDocumentLanguage` (`ingestion/fileFilter.ts`) | **DE-EXPORTED** (kept module-private; `SENSITIVE_EXTENSIONS` still used by `isSensitiveFile`) |
| unused export | `retrieveChunksLexical`, `retrieveChunksHybrid`, `HybridRetrievalOptions` (`retrieval/retriever.ts`) | **REMOVED/DE-EXPORTED** — the lexical and hybrid helpers are internal to the file; `HybridRetrievalOptions` was never referenced at all |
| unused export | `claimEmbeddingLease`/`finalizeEmbedding`/`clearEmbeddingLease` re-exported from `workflows/embed.ts`; `claimSyncBatch`/`settleSyncLease` from `workflows/sync.ts` | **REMOVED** — pure pass-through re-exports, imported directly from `lib/leases/repositoryLeases` everywhere |
| unused export | 16 module-private constants/interfaces: `GEMINI_EMBEDDING_DIMENSIONS`, `GEMINI_MAX_BATCH_SIZE`, `CLOUDFLARE_EMBEDDING_DIMENSIONS`, `NVIDIA_MODELS_API_URL`, `NVIDIA_CHAT_COMPLETIONS_URL`, `LEASE_DURATION_MS`, `BOSS_AUTHORIZED_EMAILS`, `BOSS_AUTHORIZED_USERNAMES`, `TransactionClient`, `DbOrTx`, `RepositoryEmbeddingContext`, `GitHubCompareFile`, `GitHubTreeEntry`, `RepositoryProvider`, `LLMProvider`, `AssembledCitation`, `EvidenceType`, `E2ERetrievalMetrics`, `E2EAnswerMetrics`, `E2ECaseResult`, `QueryEvalResult`, `CategoryEvalMetrics` | **DE-EXPORTED** — all still used, just not from outside their module |

### Known false positive

- `tree-sitter-wasms` is reported unused by knip because it is never `import`ed. `parserManager.ts:92-98` builds the path `node_modules/tree-sitter-wasms/out/<grammar>.wasm` with `path.join` and loads it via `Parser.Language.load`, and `next.config.ts` lists it in `serverExternalPackages`. **Keep the dependency.**

### Test fix

`entitlements.test.ts > rolls back consumed query with a single atomic SQL decrement` was failing on `HEAD` before this sweep. The assertion extracted `sql\`GREATEST(...)\`` by joining `queryChunks` and keeping only chunks whose `.value` is an array, but drizzle-orm `1.0.0-rc` emits string chunks (`{value: "GREATEST("}`), so the joined SQL was always `""` and the test could never pass. **FIXED** — the extraction now joins string chunks too. The production code was already correct.

### Coverage config note

`vitest.config.ts` coverage is scoped to `src/lib/ingestion/**` and `src/workflows/**` only. Everything else — `app/api`, `lib/auth`, `lib/plans`, `lib/retrieval`, `lib/embeddings`, `lib/mermaid` — is excluded, so `npm run test:coverage` reports no coverage for it. Widen `include` if you want those numbers.

### Not changed

- `.well-known/workflow/v1/**/route.js` files are reported as orphans by dependency-cruiser. They are `workflow` SDK build output, gitignored, and registered as real routes in the Next.js build. **Not dead code.**
- `npm ci` and the lockfile's internal consistency are resolved (pinned `better-auth` to `1.6.24`, added `legacy-peer-deps=true` in `.npmrc`, and regenerated `package-lock.json`).

---

## 12. Workspace UI cleanup, font unification, and composer layout (2026-10-08)

The following workspace and design improvements were implemented:

- **Repository search shortcut:** `src/components/ui/Kbd.tsx` displays `Ctrl K` on Windows and non-Apple platforms instead of the Windows glyph.
- **Sidebar plan section simplified:** `src/app/components/workspace/Sidebar.tsx` removed the cluttered plan name, repository and query counts ("Infinite"), and "v1.1 · Beta" tags. Replaced with a clean, single `Plan & usage` action button that triggers `PlanUsageModal`.
- **Elimination of `/select` route:** Fully removed `src/app/select/` route and all buttons or links pointing to it (including "Browse Github repositories"), centralizing repo management into the workspace.
- **Font system:** Preserved Ethnocentric (`--font-brand`, `font-brand` at `src/app/fonts/ethnocentric/`) specifically for the DRAG wordmark and watermark. Audited all other text to ensure no third font is used:
  1. Manrope (`--font-sans`): body, UI, buttons, and general text.
  2. Nohemi (`--font-display`): display headings with expanded letter spacing.
  3. Fira Code (`--font-mono`): code snippets, line numbers, and monospace chips.
  4. Ethnocentric (`--font-brand`): dedicated solely to DRAG logo branding.
- **Display font letter spacing expansion:** Expanded `--tracking-display` from `-0.05em` to `0.03em` in `src/app/globals.css`. Bound letter spacing directly into `@utility font-display` so any heading using `font-display` inherits the open spacing. Removed hardcoded negative tracking (`tracking-[-0.05em]`, `tracking-[-0.03em]`) across the workspace and landing pages.
- **Composer layout re-architecture:** Restructured `src/app/components/workspace/Composer.tsx` into a vertical column. The chat textarea is positioned on top with a comfortable `min-h-[52px]` and full width, while the bottom toolbar cleanly separates controls: `ModelSelector` on the bottom-left, and voice input plus send buttons on the bottom-right.

---

## 13. Modal sizing parity, focus ring cleanup, and in-place message editing (2026-10-08)

The following improvements were implemented across workspace components and API routes:

- **Modal sizing and viewport alignment:** Updated `src/components/ui/Modal.tsx` to conditionally apply `max-w-lg` only when no custom `max-w-*` class is provided, avoiding utility class conflicts in Tailwind v4. Centered modals with viewport padding and set dialogs to flex column layout with `flex-1 min-h-0 overflow-y-auto` scroll areas. Updated both `PlanUsageModal.tsx` and `AddRepoModal.tsx` to consistent dimensions (`max-w-4xl h-[82vh] max-h-[780px] min-h-[580px]`), giving plan cards and the repository picker comfortable breathing room.
- **Focus outline cleanup:** Removed intrusive global outline rules for `input:focus-visible` and `textarea:focus-visible` in `src/app/globals.css`. Updated `src/app/components/workspace/Composer.tsx` to ensure the chat textarea renders without inner focus boxes. Updated `src/app/components/workspace/Sidebar.tsx` and `src/app/components/workspace/ConversationList.tsx` to eliminate multiple concentric focus rings on the search bars, keeping a single clean accent border.
- **In-place user message editing:** Updated `src/app/components/workspace/MessageBubble.tsx` so clicking Edit turns the user prompt into an inline textarea with Save and Cancel controls, rather than copying text down to the composer. The inline textarea uses neutral border styling with no focus outline lines. Pressing Escape cancels, and Enter saves the edit.
- **Message update persistence:** Added `PATCH /api/conversations/[id]/messages` in `src/app/api/conversations/[id]/messages/route.ts` with user authorization checks and unit tests. Updated `src/app/workspace/page.tsx` to optimistically update message state and persist edits to Neon PostgreSQL.
- **Sidebar width and metadata contrast:** Increased desktop sidebar width in `src/app/components/workspace/Sidebar.tsx` to 304px (and mobile to 325px), allowing search placeholder text and shortcut badges to fit without truncation. Elevated repository metadata contrast in `src/app/components/workspace/RepoList.tsx` by upgrading branch name to `font-mono font-medium text-ink`, size and sync times to `text-ink-2`, and separating with distinct midpoint dots.
- **Enterprise plan header:** Removed the building icon next to the Enterprise plan header in `src/app/components/workspace/PlanUsageModal.tsx`, aligning it with the clean typography of the Free and Hobby cards.

---

## 14. Workspace chat hardening, regeneration flow, and dynamic edit bubble (2026-10-08)

The following fixes and enhancements were implemented across workspace chat components and backend endpoints:

- **Answer regeneration flow.** `src/lib/chat/conversation.ts` and `src/app/api/chat/route.ts` implement dedicated `isRegenerate` and `regenerateMessageId` parameters. Instead of routing through the failed-answer retry path, regeneration targets the completed assistant message directly. It updates the existing message row in place (`status: "streaming"`, `citations: null`) and queries prior history strictly before the corresponding user prompt (`createdAt < targetUserMsg.createdAt`). This keeps thread ordering stable, prevents duplicate answers, and excludes later turns from the LLM prompt.
- **Message edit verification and rollback.** `handleEditMessage` in `src/app/workspace/page.tsx` checks the `PATCH` response status. If the network request fails or returns an error status code, it rolls the displayed prompt back to its original saved text and displays an error message.
- **Temporary message ID protection.** `src/app/components/workspace/MessageBubble.tsx` disables the Edit button while `message.id` starts with `temp-`. This prevents edits while the initial answer streams before the database ID returns.
- **Shared message length limits.** Enforced `MAX_CHAT_MESSAGE_LENGTH` (4000 characters) in `PATCH /api/conversations/[id]/messages` and on the inline editor in `MessageBubble.tsx`. The inline Save button remains disabled when content is empty or exceeds 4000 characters.
- **Model selector mobile viewport anchoring.** Anchored the upward model menu in `src/app/components/workspace/ModelSelector.tsx` to `bottom-full mb-2 left-0` with `max-w-[calc(100vw-2rem)]`. The menu stays within the chat column and screen bounds without clipping on small viewports.
- **Model choice persistence across repository switches.** Lifted `isModelManuallyPicked` state to `src/app/workspace/page.tsx` and threaded it through `WorkspaceShell`, `ChatWindow`, and `Composer`. Switching repositories no longer overwrites a manually chosen model with the fastest probe winner.
- **Speech recognition controls and boundaries.** Added whitespace boundary detection in `src/app/components/workspace/Composer.tsx` when appending new speech transcripts to existing text. Speech recognition now stops automatically when the form submits, and the Stop button remains clickable during streaming while recording.
- **Dynamic inline edit bubble sizing.** Replaced the fixed 85% width edit box in `src/app/components/workspace/MessageBubble.tsx` with a CSS grid layout (`min-w-[180px] max-w-[75%]`). An invisible mirror span resizes the container dynamically in both width and height as text changes, matching the bubble appearance and right alignment.

---

## 15. Dependency peer resolution and CI lockfile repair (2026-10-08)

The following fixes resolved `npm ci` failures in GitHub Actions and local `npm install` `ERESOLVE` errors:

- **Pinned Better Auth.** `package.json` pins `"better-auth": "1.6.24"`. This prevents automatic minor resolution to Better Auth 1.7.x, which removed `providerId` as a valid selector in `auth.api.getAccessToken` and would break six server routes and mock assertions across tests.
- **Enabled legacy peer dependencies configuration.** Created `.npmrc` with `legacy-peer-deps=true`. This allows npm to accept `drizzle-orm@^1.0.0-rc.4` and `drizzle-kit@^1.0.0-rc.4` alongside `@better-auth/drizzle-adapter@1.6.24` and `better-auth@1.6.24` without tripping strict peer resolution checks in npm 7+.
- **Clean lockfile regeneration.** Regenerated `package-lock.json` using `npm install --package-lock-only`. The missing lockfile entries (including `@nestjs/common` and transitive packages) were reconciled. `npm ci --dry-run` and clean `npm install` now succeed without errors.
- **Test discriminated union narrowing.** Updated `src/lib/chat/__tests__/retryIdempotency.test.ts` to narrow `result.ok` before asserting `result.status`, satisfying TypeScript type checking on `ConversationChatResult` and oxlint `unicorn/no-thenable` checks.






