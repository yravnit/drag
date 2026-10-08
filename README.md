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
      │         ├── embedRepository (Gemini or Cloudflare, 768-dim -> Postgres)
      │         └── syncRepositories (Commit hash diffing & 24h cron)
      │
      └──> [RAG Chat Pipeline]
                ├── Query Embedding (Gemini for public, Cloudflare for private)
                ├── Hybrid Search (pgvector cosine + Postgres full-text)
                ├── Reciprocal Rank Fusion (RRF k=60)
                ├── Overlap Deduplication & Character Budgeting (24000 chars)
                └── Streaming Chat Completion (NVIDIA NIM)
```

Embedding provider is chosen server-side from verified repository visibility: **Gemini**
(`gemini-embedding-2`, 768 dims) for public repositories, **Cloudflare Workers AI**
(`@cf/qwen/qwen3-embedding-0.6b`, 768 dims) for private ones. There is no fallback between
them — a private repository that cannot reach Cloudflare fails rather than sending source to
Gemini.

---

## Key technical features

- **Resilient repository acquisition.** Streams tarball archives directly to tar extraction without buffering full archives in memory. File count, repository size, and branch are bounded by the caller's plan (Free: 2,500 files / 50 MB / `main` only; Hobby: 12,500 files / 250 MB; Enterprise: 50,000 files / 1 GB; BOSS: unlimited).
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
- NVIDIA NIM API key (from https://integrate.api.nvidia.com) — chat completions
- Google Gemini API key — embeddings for **public** repositories
- Cloudflare Workers AI API token and account ID — embeddings for **private** repositories

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
| `NVIDIA_API_KEY` | NVIDIA NIM API key for chat completions and weekly model discovery |
| `GEMINI_API_KEY` | Google Gemini API key. Required to index **public** repositories. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI API token. Required to index **private** repositories. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID, used with the Workers AI token. |
| `CRON_SECRET` | Secret token to authorize cron routes (optional in development) |

`GEMINI_API_KEY` and the two `CLOUDFLARE_*` values are not interchangeable. A deployment missing
`GEMINI_API_KEY` cannot index public repositories at all; a deployment missing the Cloudflare
values cannot index private repositories, and DRAG will not fall back to Gemini for them.

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
