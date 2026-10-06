import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession } from "better-auth/plugins";
import { db } from "@/db/db";
import { serverEnv } from "@/data/serverEnv";
import * as schema from "@/db/schema";
import { GITHUB_ACCESS_SCOPES, getUserAccessMode } from "./accessMode";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  socialProviders: {
    github: {
      clientId: serverEnv.GITHUB_CLIENT_ID,
      clientSecret: serverEnv.GITHUB_CLIENT_SECRET,
      scope: [...GITHUB_ACCESS_SCOPES.public],
    },
  },
  plugins: [
    customSession(async ({ session, user }) => {
      const accessMode = await getUserAccessMode(db, user.id);
      return {
        session,
        user: {
          ...user,
          accessMode,
        },
      };
    }),
  ],
  account: {
    encryptOAuthTokens: true,
  },
  secret: serverEnv.BETTER_AUTH_SECRET,
  baseURL: serverEnv.BETTER_AUTH_URL,
});
