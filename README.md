# DRAG (Developer Repository Augmented Generation)

DRAG is an AI assistant for software codebases. Users authenticate with GitHub, index any public repository, and chat with their codebase using a hybrid retrieval-augmented generation (RAG) pipeline.

Answers include bracket citations that link directly to code lines, complete with an interactive file viewer, syntax highlighting, and verified GitHub source links.

---

## Architecture overview

```
[GitHub OAuth]
      │
      ▼
[Next.js App Router (Client & Server)]
      │
      ├──> [Postgres (Neon + pgvector)]
      │         ├── repositories, repository_files, chunks
      │         ├── user_repositories, repository_access_cache
      │         └── conversations, messages, rate_limits
      │
      ├──> [Vercel Workflow Engine]
      │         ├── ingestRepository (Tarball stream -> Tree-sitter -> Chunks)
      │         ├── embedRepository (NIM 768-dim embeddings -> Postgres)
      │         └── syncRepositories (Commit hash diffing & 24h cron)
      │
      └──> [RAG Chat Pipeline]
                ├── Query Embedding (NVIDIA NIM)
                ├── Hybrid Search (pgvector cosine + Postgres tsvector)
                ├── Reciprocal Rank Fusion (RRF k=60)
                ├── Overlap Deduplication & Token Budgeting (4000 tokens)
                └── Streaming Chat Completion (NIM minimax-m3)
```

---

## Key technical features

- **Resilient repository acquisition.** Streams tarball archives directly to tar extraction without buffering full archives in memory. Bounded by size limits (max 5,000 files, max 250 MB).
- **Tree-sitter AST parsing.** Extracts symbols, classes, functions, and semantic blocks across 13 programming languages with LRU parser caching.
- **Incremental sync.** Tracks per-file SHA-256 content hashes. Incremental updates only re-parse and re-embed files that changed in git commits.
- **Distributed lease claiming.** Sync and embedding workflows use Postgres transactions with `FOR UPDATE SKIP LOCKED` and 10-minute lease timeouts. Prevents duplicate work across serverless runs.
- **Hybrid retrieval.** Combines semantic vector similarity with full-text lexical search using Reciprocal Rank Fusion. Outperforms pure vector search on code identifiers and symbol names.
- **Context assembly and deduplication.** Deduplicates overlapping line ranges from the same file and enforces strict token budgets before prompt submission.
- **Citation provenance.** Generates bracket citations (`[1]`, `[2]`) referencing exact files and line ranges. Clicking a citation opens a drawer with syntax highlighting and direct GitHub jump links.
- **Hardened diagram rendering.** Mermaid diagrams run in strict mode and pass through DOMPurify SVG sanitization to strip malicious scripts and event handlers.
- **Multi-tenant isolation and rate limits.** Users can only access authorized repositories and threads. Chat has a persistent rate limit of 30 requests per minute, and ingestion is capped at 5 repositories per hour.

---

## GitHub access modes and permissions

DRAG supports two distinct GitHub access modes selected before sign-in:

### 1. Public-only (default)
- **Scopes requested**: `public_repo`, `read:user`
- **Access**: Reads and indexes public repositories only.
- **Security enforcement**: Server-side checks reject any attempt to index private repositories with HTTP 403.
- **Upgrade path**: Users can upgrade to Full access at any time from the workspace or repository modal.

### 2. Full repository access
- **Scopes requested**: `repo`, `read:org`
- **Access**: Reads and indexes public, private, and organization repositories.
- **Consent requirement**: Upgrades trigger a fresh OAuth consent flow requesting the broader scopes before access is granted.

Permissions are verified directly against the user's OAuth account record in PostgreSQL on every sensitive operation. Client-side selection claims are never trusted.

---

## Prerequisites

- Node.js 20 or higher
- PostgreSQL instance with `pgvector` enabled (such as Neon)
- GitHub OAuth application credentials
- NVIDIA NIM API key (from https://integrate.api.nvidia.com)

---

## Local setup

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/yravnit/drag.git
cd drag
npm ci
```

2. Configure environment variables:

```bash
cp .env.example .env.local
```

Fill in the required values in `.env.local`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string with pgvector enabled |
| `BETTER_AUTH_SECRET` | Random 32+ character string (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | Application base URL (`http://localhost:3000` for local dev) |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `NVIDIA_API_KEY` | NVIDIA NIM API key for embeddings and LLM streaming |
| `CRON_SECRET` | Secret token to authorize cron routes (optional in development) |

3. Set up the database schema:

```bash
npm run db:push
```

4. Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Deployment to Vercel

1. Push your code to a GitHub repository.
2. Import the project into Vercel.
3. Configure the environment variables listed above in the Vercel Project Settings.
4. Set `CRON_SECRET` in your project environment to secure scheduled cron endpoints.
5. Deploy. Vercel automatically detects Next.js 16 and configures the build output.
6. In your GitHub OAuth App settings, update the Authorization Callback URL:
   `https://<your-vercel-domain>/api/auth/callback/github`

The scheduled jobs in `vercel.json` run automatically:
- `/api/cron/sync` runs daily at 06:00 UTC to sync repositories with remote HEAD commits.
- `/api/cron/embed` runs daily at 18:00 UTC to reclaim expired leases and process pending embeddings.

---

## Testing and evaluation commands

```bash
# Run unit and integration tests (Vitest)
npm test

# Run linter and type-checking
npm run lint
npm run lint:ox
npx tsc --noEmit

# Run retrieval benchmark (semantic baseline vs hybrid RRF)
npm run eval:retrieval

# Run end-to-end RAG evaluation (curated and held-out test suites)
npm run eval:e2e

# Run load and concurrency benchmark
npm run eval:load

# Build for production
npm run build
```

---

## Known limitations

1. **Single-repository chat scope.** Chat sessions query one repository at a time. Cross-repository queries across separate projects are not supported.
2. **GitHub OAuth app scope.** DRAG uses standard OAuth apps with user consent (either Public-only or Full access). Fine-grained GitHub App bot installations are not currently used.
3. **Repository access-cache policy.** GitHub permissions are cached for one hour to prevent hitting GitHub API rate limits. If access is revoked on GitHub, access in DRAG revokes after the cache entry expires or when the user deletes the repository from their workspace.
4. **Repository size constraints.** Repositories larger than 5,000 files or 250 MB are rejected during addition to prevent serverless function memory exhaustion.
5. **Provider dependency.** Embeddings use NVIDIA NIM `llama-nemotron-embed-1b-v2` (768 dimensions), and completions use `minimax-m3`. Self-hosted NIM containers can be configured by updating `EMBEDDING_BASE_URL` and `LLM_BASE_URL`.
