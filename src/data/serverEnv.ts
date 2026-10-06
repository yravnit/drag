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
    // Embedding configuration (NVIDIA NIM API with llama-nemotron-embed-1b-v2)
    // NVIDIA_API_KEY is required when using the hosted NVIDIA endpoint.
    NVIDIA_API_KEY: z.string().min(1).optional(),
    EMBEDDING_MODEL: z.string().default("nvidia/llama-nemotron-embed-1b-v2"),
    // Fixed at 768 — must match the vector(768) column in the chunks table and HNSW index.
    // Do not change this without a corresponding DB migration.
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
    EMBEDDING_BASE_URL: z.url().default("https://integrate.api.nvidia.com/v1"),
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

// Runtime guard: NVIDIA_API_KEY must be set when using the hosted NVIDIA NIM endpoint.
// This is checked here (not in the schema) because it is a cross-field dependency.
const NVIDIA_HOSTED_BASE_URL = "https://integrate.api.nvidia.com/v1";
if (serverEnv.EMBEDDING_BASE_URL === NVIDIA_HOSTED_BASE_URL && !serverEnv.NVIDIA_API_KEY) {
  throw new Error(
    "NVIDIA_API_KEY is required when EMBEDDING_BASE_URL is the hosted NVIDIA NIM endpoint. " +
    "Set NVIDIA_API_KEY in your environment or configure a self-hosted EMBEDDING_BASE_URL.",
  );
}
