import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";
 
export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});