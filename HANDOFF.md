# DRAG — Agent Handoff & Requirement Tracker

> **FOR AGENTS**: Read this document in full at the start of every session before writing any code.
> This is the single source of truth for project state, conventions, and what is/isn't built.

---

## 1. What is DRAG?

**Developer Repository Augmented Generation** — an AI assistant for software repositories.

A user authenticates with GitHub OAuth, submits a repository URL, the system indexes it (parse → chunk → embed → store), and then the user can chat with the codebase via a retrieval-augmented generation (RAG) pipeline.

**Full product name**: DRAG v1  
**Stack**: Next.js 16 · TypeScript · Drizzle ORM · Neon PostgreSQL · pgvector · Better Auth · Vercel Workflow SDK  
**Hosting**: Vercel  

---

## 2. Design Principles (NON-NEGOTIABLE)

These come from `project.list.md`:

1. **Prefer simple solutions over clever ones**
2. **Optimize for correctness before performance**
3. **Keep every module replaceable** — parser, embeddings, vector store, LLM must each be swappable
4. **Design for future expansion without implementing future features** (no YAGNI violations inward; no premature feature additions outward)
5. **Follow tutorial architecture as closely as possible; only deviate where code repos require different handling**
6. **Always write unit and integration tests for newly created code and files whenever adding new features or modules**
7. **Be cautious with Drizzle ORM and cross-check official documentation before changing anything that affects Drizzle** — The project relies on `drizzle-orm` v1 Release Candidate (`^1.0.0-rc.4`), which introduces breaking changes (e.g. Relational Queries v2 `defineRelations(schema, callback)` and `snakeCase.table`). Always verify signatures against Drizzle v1 docs before making database or schema modifications.

---

## 3. ```
drag/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (Geist font, dark theme)
│   │   ├── page.tsx                # Auth landing page (GitHub OAuth sign-in/out)
│   │   ├── globals.css
│   │   └── api/
│   │       ├── auth/[...all]/      # Better Auth catch-all route
│   │       ├── cron/
│   │       │   ├── embed/
│   │       │   │   └── route.ts   # Vercel Cron API: GET /api/cron/embed (embed pending chunks)
│   │       │   └── sync/
│   │       │       └── route.ts   # Vercel Cron API: GET /api/cron/sync (verify repo SHA & ingest if changed)
│   │       └── workflows/
│   │           ├── embed/
│   │           │   └── route.ts   # Vercel Workflow API: POST /api/workflows/embed (embedding task)
│   │           └── ingest-repository/
│   │               └── route.ts   # Vercel Workflow API: POST /api/workflows/ingest-repository
│   ├── data/
│   │   ├── serverEnv.ts            # @t3-oss/env-nextjs server env validation
│   │   └── clientEnv.ts            # @t3-oss/env-nextjs client env validation
│   ├── db/
│   │   ├── db.ts                   # Drizzle + Neon connection
│   │   ├── schema.ts               # Barrel re-export (auth + repository + chunks + repositoryFiles)
│   │   ├── relations.ts            # Drizzle defineRelations (centralized)
│   │   ├── schemas/
│   │   │   ├── auth.ts             # Better Auth tables (user, session, account, verification)
│   │   │   ├── repository.ts       # repositories table
│   │   │   ├── chunks.ts           # chunks table + vector custom type + HNSW index + unique constraint
│   │   │   └── repositoryFiles.ts  # repository_files table (per-file content hash tracking)
│   │   └── migrations/
│   │       └── 20260802155700_loving_amphibian/   # Clean baseline migration (auth + repositories + chunks + repositoryFiles)
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── server.ts               # Better Auth server config (GitHub OAuth, encrypted tokens)
│   │   │   └── client.ts               # Better Auth React client
│   │   └── ingestion/
│   │       ├── githubApiClient.ts     # Resilient GitHub HTTP client (retries, rate limits, jitter)
│   │       ├── repositoryProvider.ts  # RepositoryProvider interface + GitHubArchiveRepositoryProvider (revisions, streaming)
│   │       ├── fileFilter.ts          # File discovery, .gitignore, custom ignore rules, language detection
│   │       ├── parserManager.ts       # Concurrency-safe Tree-sitter WASM parser lifecycle (withParser)
│   │       ├── semanticChunker.ts     # AST -> semantic chunks (13 languages + project docs, accumulated line/char splitting)
│   │       ├── batchProcessor.ts      # Bounded parallel processing with SHA-256 per-file content hash
│   │       ├── dbLayer.ts             # Drizzle persistence (atomic UPSERT, transient retries, incremental transactions)
│   │       └── __tests__/             # Full Vitest unit test suite (77 tests passing)
│   ├── workflows/
│   │   ├── embed.ts                # Core Vercel Workflow file (NVIDIA NIM embeddings, batch size 250, max concurrency 2)
│   │   ├── ingest.ts               # Core Vercel Workflow file ("use workflow" / "use step", skip unchanged, incremental)
│   │   └── __tests__/             # Workflow unit tests
│   └── data/
├── HANDOFF.md                      # This file — agent context and requirement tracker
├── project.list.md                 # Product requirements (source of truth)
├── vercel.json                     # Vercel deployment configurations & Cron schedules (Saturday 12:00 AM IST)
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── tsconfig.json
└── .env                            # Local secrets (never commit)
```


---

## 4. Environment Variables

All server env vars are validated via `src/data/serverEnv.ts`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | YES | Neon PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | YES | Min 32-char secret for Better Auth |
| `BETTER_AUTH_URL` | YES | Base URL of the app (e.g. `http://localhost:3000`) |
| `GITHUB_CLIENT_ID` | YES | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | YES | GitHub OAuth App client secret |
| `CRON_SECRET` | Optional | Secret for Vercel Cron authorization header (used in production by `isCronAuthorized`) |
| `GITHUB_TOKEN` | Optional | GitHub PAT for ingestion workflow (avoids rate limits, accesses private repos) |
| `NVIDIA_API_KEY` | **Required** when using hosted NVIDIA endpoint | NVIDIA API key for NIM embedding generation (`llama-nemotron-embed-1b-v2`). Must be set when `EMBEDDING_BASE_URL` is `https://integrate.api.nvidia.com/v1`. |
| `EMBEDDING_MODEL` | Optional | Embedding model (default: `nvidia/llama-nemotron-embed-1b-v2`) |
| `EMBEDDING_DIMENSIONS` | **Fixed at 768** | Pinned to match `vector(768)` in DB schema. Do not change without a migration. |
| `EMBEDDING_BASE_URL` | Optional | NVIDIA NIM API base URL (default: `https://integrate.api.nvidia.com/v1`) |

> **DO NOT** add env vars that bypass `serverEnv.ts`. All new env vars must go through `createEnv()`.

---

## 5. Database Schema

### `repositories` table (`src/db/schemas/repository.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `name` | text NOT NULL | repo name |
| `owner` | text NOT NULL | GitHub login |
| `url` | text UNIQUE | html_url from GitHub API |
| `default_branch` | text NOT NULL | default branch name |
| `description` | text nullable | |
| `primary_language` | text nullable | |
| `head_commit_sha` | text nullable | HEAD SHA at time of indexing; used for change detection |
| `indexed_at` | timestamptz nullable | set after successful index run |
| `created_at` | timestamptz | auto |
| `updated_at` | timestamptz | auto-updated |

*Indexes & Constraints*:
- Unique constraint: `url`
- Composite Index: `repositories_owner_name_idx` on `(owner, name)` (used by `getRepositoryByOwnerAndName`)

### `chunks` table (`src/db/schemas/chunks.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `repository_id` | uuid FK → repositories.id ON DELETE CASCADE | |
| `file_path` | text NOT NULL | relative path within repo |
| `language` | text NOT NULL | typescript / tsx / javascript / jsx / python / go / rust / java / kotlin / csharp / cpp / c / php / markdown / json / yaml / toml / dockerfile / text / config |
| `chunk_type` | text NOT NULL | function / class / method / module / document / config |
| `symbol_name` | text nullable | function/class name if applicable |
| `start_line` | integer NOT NULL | 1-indexed |
| `end_line` | integer NOT NULL | 1-indexed |
| `text` | text NOT NULL | raw source text |
| `embedding` | vector(768) nullable | **Fixed at 768 dimensions** — matches `vector(768)` in migration SQL and HNSW index |
| `created_at` | timestamptz | auto |
| `updated_at` | timestamptz | auto-updated |


*Indexes & Constraints*:
- Unique Index: `chunks_repo_file_lines_idx` on `(repository_id, file_path, start_line, end_line)` (duplicate protection)
- HNSW Vector Index: `chunks_embedding_hnsw_idx` on `embedding` using `vector_cosine_ops`

### `repository_files` table (`src/db/schemas/repositoryFiles.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `repository_id` | uuid FK → repositories.id ON DELETE CASCADE | |
| `file_path` | text NOT NULL | relative path within repo |
| `content_hash` | text NOT NULL | SHA-256 hash of file content |
| `size_bytes` | text nullable | file size in bytes |
| `indexed_at` | timestamptz nullable | timestamp when file was indexed |
| `created_at` | timestamptz | auto |
| `updated_at` | timestamptz | auto-updated |

*Indexes & Constraints*:
- Unique Index: `repo_files_repo_id_file_path_idx` on `(repository_id, file_path)`

> **MIGRATION STATUS**: Database schema was pushed directly via `db push`, and old migrations were replaced with a clean single baseline migration in `src/db/migrations/20260802155700_loving_amphibian/`.
> The baseline migration covers all tables (`user`, `session`, `account`, `verification`, `repositories`, `chunks`, `repository_files`) and indexes.

---

## 6. Ingestion Pipeline — Full Spec

### Step 1 — Repository Acquisition & Incremental Diffing

**Input**: `{ owner, repo, authToken?, revision?, batchSize?, extraIgnorePatterns? }`

1. Instantiate `GitHubApiClient` (handles exponential backoff, rate limits 429, jitter, and HTTP retries).
2. Fetch repository metadata via GitHub API for target `revision` (branch, tag, or commit SHA; defaults to `default_branch`).
3. Check existing `repositories` record in PostgreSQL by URL.
4. **Skip Unchanged Repositories**: If `headCommitSha` is unchanged, return early (`skipped: true`).
5. Download `.tar.gz` archive via GitHub Archive API — **stream directly to tar extractor** (no full-archive buffer).
6. Extract into a unique `os.tmpdir()` workspace.
7. Recursively discover files adhering to `.gitignore` and `extraIgnorePatterns`.
8. **Per-File Hash Diffing**: Compare SHA-256 `content_hash` of discovered files against stored `repository_files` records in DB.
9. Compute modified/added files to process and deleted files to prune.
10. Upsert repository record using atomic single query `INSERT ... ON CONFLICT(url) DO UPDATE`.
11. Cleanup temporary workspace in `finally` block.

### Step 2 — Parsing, Chunking & Transactional Persistence

**Input**: `filesToProcess`, `deletedFilePaths`, `isIncremental`

1. Read file contents and compute SHA-256 hash.
2. For source files (TS, TSX, JS, JSX, Python, Go, Rust, Java, Kotlin, C#, C++, C, PHP): parse with Tree-sitter WASM via `withParser()`, extract semantic chunks.
3. For project files (`README.md`, `package.json`, `LICENSE`, `CONTRIBUTING.md`, `Makefile`, `compose.yaml`, etc.): emit document/config chunk.
4. Split oversized chunks based on accumulated lines (>= 120) or characters (>= 4000) at statement boundaries.
5. Process in bounded batches (`BatchProcessor` with default `batchSize: 10`).
6. Skip individual file errors; report per-file failure.
7. Persist chunks and `repository_files` records inside a **single transaction**:
   - For full replace: atomic delete all + insert all.
   - For incremental: delete chunks & file records for modified/deleted files, insert new chunks & file records for added/modified files.

### RepositoryProvider Interface

```typescript
interface RepositoryProvider {
  acquire(owner: string, repo: string, options?: string | AcquireOptions): Promise<AcquiredRepository>;
}
```

---

## 7. Auth Setup

- **Provider**: Better Auth with GitHub OAuth
- **Session strategy**: Cookie-based (Better Auth default)
- **Scope**: `public_repo` (GitHub) — required for private repository ingestion
- **Token encryption**: `account.encryptOAuthTokens: true`
- **Tables**: `user`, `session`, `account`, `verification` (all in `auth.ts` schema)
- **Route**: `/api/auth/[...all]` — Better Auth catch-all
- **Client**: `src/lib/auth/client.ts` — exports `signIn`, `signOut`, `useSession`
- **Cron auth**: `src/lib/cron/cronAuth.ts` — timing-safe `isCronAuthorized(request)` helper used by both cron routes

---

## 8. What Is Built

| Feature | Status | Key Files |
|---|---|---|
| GitHub OAuth Sign-in UI | DONE | `src/lib/auth/server.ts`, `page.tsx`, `/api/auth/[...all]` |
| Auth DB schema | DONE + MIGRATED | `schemas/auth.ts` |
| Repository DB schema, Migration & pgvector HNSW index | DONE + MIGRATED | `schemas/repository.ts`, `schemas/chunks.ts`, `schemas/repositoryFiles.ts` |
| GitHub API Client (resilient retries & rate limits) | DONE | `githubApiClient.ts` |
| RepositoryProvider (Revisions, Streaming) | DONE | `repositoryProvider.ts` |
| File Discovery, .gitignore & Configurable Rules | DONE | `fileFilter.ts` |
| Concurrency-Safe Tree-sitter Parser Manager | DONE | `parserManager.ts` |
| Expanded Semantic Chunker (13 languages + docs) | DONE | `semanticChunker.ts` |
| Batch Processor (isolated per-task parsers + SHA-256 hashes) | DONE | `batchProcessor.ts` |
| Database Layer (Atomic UPSERT, Transient Retry, Incremental) | DONE | `dbLayer.ts` |
| Vercel Ingestion Workflow (Skip Unchanged, Incremental Hash Diff) | DONE | `src/workflows/ingest.ts` |
| Vercel Workflow API Route Handler | DONE | `src/app/api/workflows/ingest-repository/route.ts` |
| Embeddings Workflow (NVIDIA NIM, Batching, DB Update) | DONE | `src/workflows/embed.ts`, `src/app/api/workflows/embed/route.ts` |
| E2E Mock Test Harness | DONE | `src/lib/ingestion/test-workflow.ts` |
| NVIDIA NIM Embedding Provider & Configurable Dimensions | DONE | `src/lib/embeddings/config.ts`, `src/lib/embeddings/embeddingProvider.ts` |
| Env var validation | DONE | `serverEnv.ts` |
| Vercel Cron Job Configuration | DONE | `vercel.json` |
| Cron Embeddings Route | DONE | `src/app/api/cron/embed/route.ts` |
| Cron Repository Sync Route (Incremental Diff) | DONE | `src/app/api/cron/sync/route.ts` |
| Embedding Rate-Limiting & Concurrency | DONE | `src/workflows/embed.ts` (Batch size: 250, Max concurrency: 2) |
| Drizzle defineRelations v1 RC mapping | DONE | `src/db/relations.ts`, `src/db/__tests__/relations.test.ts` |
| Code Flow & Pipeline Documentation | DONE | `docs/ingestion_embedding_flow.md` |



---

## 9. What Is NOT Built (Planned for v1)

These features are **in-scope for v1** but not yet implemented:

| Feature | Priority | Notes |
|---|---|---|
| Vector search / Retrieval module | NEXT | pgvector cosine similarity, top-K retrieval |
| Chat API route | NEXT | `/api/chat` — embed question, retrieve, call LLM, stream |
| Repository indexing UI page | NEXT | Submit repo URL, trigger ingest, show status |
| Chat UI page | NEXT | Messages, source citations, Mermaid rendering |
| Indexing status tracking | NEXT | Polling or webhook for progress |
| Feature / Repo Knowledge Graph Mode | FUTURE | Command or workflow mode to 'make a knowledge graph' of a feature or the repo, which automatically edits and updates the corresponding Markdown flow/knowledge graph documentation when changes to the ingestion/embedding flow occur at any state. |

---

## 10. Out of Scope (v1) — DO NOT IMPLEMENT

- Hybrid retrieval (BM25 + vector)
- Git history search / commit embeddings
- PR indexing
- Multi-repository indexing in a single chat
- Local repository support (GitHub only in v1)
- Resume (PDF/Markdown) support (Note: Planned for future iterations; keep repository route names distinct to support this extension, i.e. `ingest-repository`)
- VS Code extension, CLI, SaaS features, team collaboration

---

## 11. Key Technical Constraints (Never Violate)

| Constraint | Why |
|---|---|
| Use Tree-sitter WASM for parsing — no regex, Babel, or tsc | Spec requirement |
| Stream tarball via `pipeline()` — no `arrayBuffer()` | Memory safety for large repos |
| Batch processing — no unbounded `Promise.all(files.map(...))` | Prevents resource exhaustion |
| Skip individual file errors, abort on repo-level errors | Spec requirement |
| Atomic delete+insert in a transaction for chunks | Crash-safe idempotency |
| All env vars through `createEnv()` in `serverEnv.ts` / `clientEnv.ts` | Type safety |
| Wrap `next.config.ts` with `withWorkflow()` | Enables compilation of compiler directives |
| Keep routes distinct and components separate | Improves scalability for future features |
| No raw SQL — use Drizzle ORM builders | Maintainability |
| Do not embed/retrieve/chat inside the ingest workflow | Separation of concerns |
| Write unit/integration tests for newly created code & files | Mandatory code quality and regression protection |
| Cross-check Drizzle ORM docs for v1 RC (`^1.0.0-rc.4`) | Prevents schema/relational mapping breaking changes |

---

## 12. Packages

| Package | Purpose |
|---|---|
| `next` 16.2.10 | Framework |
| `react` / `react-dom` 19 | UI |
| `better-auth` | Authentication |
| `drizzle-orm` / `drizzle-kit` | ORM + migrations |
| `@neondatabase/serverless` | Neon PostgreSQL driver |
| `workflow` | Vercel Workflow SDK |
| `web-tree-sitter` | WASM Tree-sitter runtime |
| `tree-sitter-wasms` | Pre-compiled grammar WASMs |
| `tar` | Tarball extraction (streaming) |
| `ignore` | .gitignore pattern matching |
| `@t3-oss/env-nextjs` | Type-safe environment validation |
| `zod` | Schema validation |
| `tailwindcss` v4 | Styling |

---

## 13. Next Steps for Incoming Agent (Ordered)

### Immediate (Database Migration)

```bash
# 1. Generate migration for repositories + chunks + repository_files tables
npm run db:generate

# 2. Review generated SQL in src/db/migrations, then apply to Neon DB:
npm run db:migrate
```

### Then implement (in order)

1. **Embeddings Workflow** (`/api/workflows/embed`) — **DONE**
   - Reads chunks where `embedding IS NULL` for a `repositoryId`
   - Calls NVIDIA NIM `nvidia/llama-nemotron-embed-1b-v2` (768 dims) in batches
   - Updates `chunks.embedding` using `vector(768)` schema
   - Configured with `NVIDIA_API_KEY` in `serverEnv.ts`

2. **Retrieval Module** (`src/lib/retrieval/retriever.ts`)
   - `retrieveChunks(repositoryId, questionEmbedding, topK)` returning `Chunk[]`
   - pgvector `<=>` cosine distance

3. **Chat API Route** (`/api/chat`)
   - Embed user question → retrieve top-K chunks → LLM with context → stream

4. **Repository Dashboard UI**
   - Submit GitHub URL, trigger ingest, show status

5. **Chat UI**
   - Message thread, source citations, Mermaid rendering

---

## 14. Anti-Patterns to Avoid

| Wrong | Right |
|---|---|
| `process.env.X` directly | `serverEnv.X` |
| Regex / text-based chunking | Tree-sitter only |
| `archiveRes.arrayBuffer()` | `pipeline(Readable.fromWeb(...), tar.x(...))` |
| `Promise.all(files.map(...))` unbounded | `BatchProcessor` with batchSize |
| Reading file content during discovery | Only read during Step 2 |
| Direct execution of step functions | Use `start()` and compiler directives |
| `octokit` for GitHub API | Raw `fetch()` or `GitHubApiClient` |
| Embedding in the ingest workflow | Separate `/api/workflows/embed` |

---

## 15. Quick Commands

```bash
npm run dev                    # Dev server
npm run test                   # Run full Vitest test suite (77 tests)
npm run db:generate            # Generate migration from schema changes
npm run db:migrate             # Apply migrations to Neon
npm run db:push                # Push schema directly (dev only)
npm run db:studio              # Drizzle Studio
npm run auth:generate-schema   # Regenerate auth schema (only if Better Auth version changes)
```

---

---

## 16. PR Review Changes (2026-08-04)

The following issues were addressed in a triage and resolution pass:

| Fix | Files |
|---|---|
| `isCronAuthorized` helper timing-safe comparison, fail-closed tests | `src/lib/cron/cronAuth.ts`, `cronAuth.test.ts` |
| Bounded chunk and file batch insertion inside database transactions | `src/lib/ingestion/dbLayer.ts` |
| Early file processing error checking and fail-fast for full replacements | `src/lib/ingestion/dbLayer.ts`, `src/workflows/ingest.ts` |
| Offload chunks of processed files to disk to prevent unbounded memory | `src/workflows/ingest.ts` |
| Authentication, authorization, and rate limiting route guards for POST | `src/app/api/workflows/ingest-repository/route.ts` |
| Unknown JSON body parsing and type-safety schema validation on payload | `src/app/api/workflows/ingest-repository/route.ts` |
| Bounded atomic claim & lease locking mechanism on repositories | `src/app/api/cron/embed/route.ts`, schema & migration |
| Release claim immediately on database if workflow startup fails | `src/app/api/cron/embed/route.ts` |
| `vitest.config.ts` and `HANDOFF.md` removed from `.gitignore` | `.gitignore` |
| `IngestPayload` imported from workflow module (no local duplicate) | `ingest-repository/route.ts` |
| GitHub name format validation (`/^[\w.-]+$/`) on owner/repo | `ingest-repository/route.ts` |
| `EMBEDDING_DIMENSIONS` pinned to constant `768` (single source of truth) | `chunks.ts`, `serverEnv.ts`, `embeddings/config.ts` |
| `NVIDIA_API_KEY` required guard when using hosted NVIDIA endpoint | `serverEnv.ts` |
| `z.url()` shorthand replacing `z.string().url()` | `serverEnv.ts` |
| NVIDIA NIM response sorted by `index` before extracting embeddings | `embeddingProvider.ts` |
| `NvidiaEmbeddingParams` typed interface; catch `unknown`; "START" truncate | `embeddingProvider.ts` |
| `timeout: 120_000` and `maxRetries: 2` on OpenAI client | `embeddingProvider.ts` |
| Sequential `tx.update` loop (replaces `Promise.all` inside transaction) | `embed.ts` |
| `MAX_BATCHES_PER_RUN = 100` cap; `MAX_CHUNK_CHARS = 8192` truncation; `truncate: "END"` | `embed.ts` |
| `embedRepository.maxConcurrency = 2` removed (SDK ignores it) | `embed.ts` |
| Per-repo failure collection in cron embed (no abort on single failure) | `cron/embed/route.ts` |
| Fixed generic 500 message in embed and ingest-repository routes | route handlers |
| `encodeURIComponent` on owner/repo in all GitHub API URLs | `githubApiClient.ts` |
| `Retry-After` honored without `maxDelayMs` cap | `githubApiClient.ts` |
| 300-file compare limit detection → fall back to full reconciliation | `githubApiClient.ts` |
| `WASM_FILE_NAME_MAP` moved to module scope | `parserManager.ts` |
| Parser deleted immediately if `setLanguage()` throws | `parserManager.ts` |
| `parser.parse()` null check with fallback module chunk | `semanticChunker.ts` |
| `AGENTS.md` moved from LOCKFILES → EXCLUDED_FILENAMES | `fileFilter.ts` |
| `HANDOFF.md` added to `getLanguageForFile` as markdown | `fileFilter.ts` |
| Composite index `(owner, name)` on repositories table | `repository.ts` |
| Numeric status code word-boundary matching in `isTransientDatabaseError` | `dbLayer.ts` |
| `{ cause: error }` preserved when wrapping errors and normalized | `dbLayer.ts`, `repositoryProvider.ts` |
| Removed unused catch variables resolving eslint warnings | `src/app/api/workflows/ingest-repository/route.ts` |

**Skipped (with reasoning):**
- `CREATE EXTENSION vector` in migration: Neon has pgvector pre-installed; baseline migration is a snapshot.
- Cron sync branch fallback: Already consistent — `repo.defaultBranch || "main"` used for both `getCommit` and `start()`.
- `public_repo` OAuth scope removal: Intentional per HANDOFF — required for private repo ingestion.
- `authToken` removal from IngestPayload: Intentional — supports private repo access via user OAuth token.
- `Promise.all(files.map(...))` for concurrent file reads: Anti-pattern per HANDOFF. File reads are sequential by design.
- `sizeBytes text → integer`: Breaking migration on already-pushed Neon DB. Technical debt.
- Tar extraction byte budget: Streaming prevents full-archive buffering; tar path-traversal protections active.
- `durationMs` Date.now() in workflow body: Outer orchestrator re-executes on replay; acceptable for logging.

---

## 17. Future Considerations & Cautions

> [!CAUTION]
> **Tree-sitter WASM Memory Bounds (Large Files)**
> For exceptionally large or autogenerated files (e.g., >20,000 lines of code), parsing the full syntax tree inside Tree-sitter WASM can hit WebAssembly memory constraints or cause serverless function heap exhaustion.
> * **Current Safeguard:** If `parser.parse()` returns `null`, the semantic chunker generates a single `module` chunk covering the entire file content. This prevents the pipeline from crashing.
> * **Future Action:** Implement an explicit file size gate (e.g., bypass parsing and generate fallback chunks for files > 1MB) before invoking the parser.

> [!WARNING]
> **Cron Sync Scalability & Function Timeouts**
> The current scheduled sync route [GET `/api/cron/sync`](file:///C:/Users/yravn/Desktop/ravnit/Projects/drag/src/app/api/cron/sync/route.ts) loops sequentially over all tracked repositories. If the database grows to hundreds or thousands of repositories, this route will eventually time out under Vercel's serverless function execution limits.
> * **Future Action:** Refactor the sync cron to query repositories based on `indexedAt` age and run checking/ingestion triggers in paginated batches or dispatch separate asynchronous queue items instead of a single flat loop.

*Last updated: 2026-08-04*
