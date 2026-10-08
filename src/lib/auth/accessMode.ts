import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/db";
import { account } from "@/db/schema";

export type GitHubAccessMode = "public" | "full";

export const GITHUB_ACCESS_SCOPES = {
  public: ["public_repo", "read:user"],
  full: ["repo", "read:org"],
} as const;

export class PublicAccessRestrictedError extends Error {
  constructor(
    message = "Private repositories are not permitted in Public-only access mode. Please upgrade to Full repository access.",
  ) {
    super(message);
    this.name = "PublicAccessRestrictedError";
  }
}

/**
 * Parses raw scope strings returned by GitHub OAuth or Better Auth account records.
 * Splits on commas or whitespace, strips punctuation, and normalizes to lowercase.
 */
export function parseGitHubScopes(rawScope?: string | null): string[] {
  if (!rawScope) return [];
  return rawScope
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolves the access mode from granted GitHub OAuth scopes.
 * If the granted scopes contain the "repo" scope, full repository access is active.
 * Otherwise, access mode defaults to "public".
 */
export function getAccessModeFromScopes(
  rawScope?: string | null | readonly string[] | string[],
): GitHubAccessMode {
  const scopes = Array.isArray(rawScope)
    ? rawScope.map((s) => s.trim().toLowerCase())
    : parseGitHubScopes(typeof rawScope === "string" ? rawScope : undefined);

  if (scopes.includes("repo")) {
    return "full";
  }

  return "public";
}

/**
 * Queries the user account record in PostgreSQL to resolve the active access mode.
 * Grounded in the server database record populated during OAuth token exchange.
 */
export async function getUserAccessMode(
  database: Database,
  userId: string,
): Promise<GitHubAccessMode> {
  const [acc] = await database
    .select({
      scope: account.scope,
      grantedScope: account.grantedScope,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
    .limit(1);

  if (!acc) return "public";
  return getAccessModeFromScopes(acc.grantedScope || acc.scope);
}

/**
 * Asserts that a repository is permitted under the given access mode.
 * Throws PublicAccessRestrictedError if a private repository is accessed under public mode.
 */
export function assertPublicAccessAllowed(
  isPrivate: boolean,
  mode: GitHubAccessMode,
): void {
  if (isPrivate && mode === "public") {
    throw new PublicAccessRestrictedError();
  }
}
