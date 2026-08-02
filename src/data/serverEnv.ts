import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    // Optional: used by ingestion workflow to access private repos and avoid rate-limits
    GITHUB_TOKEN: z.string().min(1).optional(),
    // Embedding configuration (NVIDIA NIM API with llama-nemotron-embed-1b-v2)
    NVIDIA_API_KEY: z.string().min(1).optional(),
    EMBEDDING_MODEL: z.string().default("nvidia/llama-nemotron-embed-1b-v2"),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
    EMBEDDING_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
