import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    // Optional: used by ingestion workflow to access private repos and avoid rate-limits
    GITHUB_TOKEN: z.string().min(1).optional(),
    // Optional: used to secure Vercel Cron routes in production
    CRON_SECRET: z.string().min(1).optional(),
    // NVIDIA_API_KEY is for LLM text generation (NimLLMProvider) and the weekly model
    // discovery cron. It is NOT used for embeddings: those go to Gemini or Cloudflare,
    // selected per repository in src/lib/embeddings/router.ts.
    NVIDIA_API_KEY: z.string().min(1).optional(),
    // Fixed at 768 — must match the vector(768) column in the chunks table and HNSW index.
    // Do not change this without a corresponding DB migration.
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
    // Google Gemini API Configuration (Public repository embeddings)
    GEMINI_API_KEY: z.string().min(1).optional(),
    // Cloudflare Workers AI Configuration (Private repository embeddings)
    CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    // Optional configurable Hobby monthly query quota.
    // null means "unmetered" downstream, so an unset variable must never mean unmetered.
    HOBBY_MONTHLY_QUERY_LIMIT: z.coerce.number().int().positive().default(250),
    // LLM configuration (NVIDIA NIM text generation API)
    LLM_MODEL: z.string().default("minimaxai/minimax-m3"),
    LLM_BASE_URL: z.url().default("https://integrate.api.nvidia.com/v1"),
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

