import { describe, it, expect, vi } from "vitest";
import {
  parseGitHubScopes,
  getAccessModeFromScopes,
  assertPublicAccessAllowed,
  getUserAccessMode,
  PublicAccessRestrictedError,
  GITHUB_ACCESS_SCOPES,
} from "../accessMode";

describe("accessMode", () => {
  describe("GITHUB_ACCESS_SCOPES", () => {
    it("defines least-privilege scopes for public mode", () => {
      expect(GITHUB_ACCESS_SCOPES.public).toEqual(["public_repo", "read:user"]);
      expect(GITHUB_ACCESS_SCOPES.public).not.toContain("repo");
    });

    it("defines full scopes for full repository access mode", () => {
      expect(GITHUB_ACCESS_SCOPES.full).toEqual(["repo", "read:org"]);
      expect(GITHUB_ACCESS_SCOPES.full).toContain("repo");
    });
  });

  describe("parseGitHubScopes", () => {
    it("returns an empty array for undefined, null, or empty string", () => {
      expect(parseGitHubScopes(undefined)).toEqual([]);
      expect(parseGitHubScopes(null)).toEqual([]);
      expect(parseGitHubScopes("")).toEqual([]);
      expect(parseGitHubScopes("   ")).toEqual([]);
    });

    it("parses comma-separated scopes", () => {
      expect(parseGitHubScopes("repo,read:org")).toEqual(["repo", "read:org"]);
    });

    it("parses space-separated scopes", () => {
      expect(parseGitHubScopes("public_repo read:user")).toEqual([
        "public_repo",
        "read:user",
      ]);
    });

    it("normalizes case and trims whitespace", () => {
      expect(parseGitHubScopes("  REPO ,  Read:Org  ")).toEqual([
        "repo",
        "read:org",
      ]);
    });

    it("ignores duplicate or empty delimiters", () => {
      expect(parseGitHubScopes(",,,repo, , read:org ,,,")).toEqual([
        "repo",
        "read:org",
      ]);
    });
  });

  describe("getAccessModeFromScopes", () => {
    it("returns 'full' when repo scope is present in string", () => {
      expect(getAccessModeFromScopes("repo,read:org")).toBe("full");
      expect(getAccessModeFromScopes("read:org,repo")).toBe("full");
      expect(getAccessModeFromScopes("repo")).toBe("full");
    });

    it("returns 'full' when repo scope is present in array", () => {
      expect(getAccessModeFromScopes(["repo", "read:org"])).toBe("full");
    });

    it("returns 'public' when only public_repo is present", () => {
      // Must not match substring 'repo' within 'public_repo'
      expect(getAccessModeFromScopes("public_repo,read:user")).toBe("public");
      expect(getAccessModeFromScopes(["public_repo", "read:user"])).toBe("public");
    });

    it("returns 'public' when scopes lack the repo scope", () => {
      expect(getAccessModeFromScopes("read:org")).toBe("public");
      expect(getAccessModeFromScopes("read:user")).toBe("public");
    });

    it("defaults to 'public' for empty or missing inputs", () => {
      expect(getAccessModeFromScopes(null)).toBe("public");
      expect(getAccessModeFromScopes(undefined)).toBe("public");
      expect(getAccessModeFromScopes("")).toBe("public");
      expect(getAccessModeFromScopes([])).toBe("public");
    });
  });

  describe("assertPublicAccessAllowed", () => {
    it("permits public repositories in public mode", () => {
      expect(() => assertPublicAccessAllowed(false, "public")).not.toThrow();
    });

    it("permits public repositories in full mode", () => {
      expect(() => assertPublicAccessAllowed(false, "full")).not.toThrow();
    });

    it("permits private repositories in full mode", () => {
      expect(() => assertPublicAccessAllowed(true, "full")).not.toThrow();
    });

    it("throws PublicAccessRestrictedError for private repositories in public mode", () => {
      expect(() => assertPublicAccessAllowed(true, "public")).toThrow(
        PublicAccessRestrictedError,
      );
      expect(() => assertPublicAccessAllowed(true, "public")).toThrow(
        "Private repositories are not permitted in Public-only access mode",
      );
    });
  });

  describe("getUserAccessMode", () => {
    it("returns 'full' when user account has repo scope in database", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { scope: "repo,read:org", grantedScope: null },
              ]),
            }),
          }),
        }),
      };

      const mode = await getUserAccessMode(mockDb as any, "user-full");
      expect(mode).toBe("full");
    });

    it("returns 'public' when user account has public_repo scope in database", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { scope: "public_repo,read:user", grantedScope: null },
              ]),
            }),
          }),
        }),
      };

      const mode = await getUserAccessMode(mockDb as any, "user-public");
      expect(mode).toBe("public");
    });

    it("uses grantedScope when present", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { scope: "public_repo", grantedScope: "repo,read:org" },
              ]),
            }),
          }),
        }),
      };

      const mode = await getUserAccessMode(mockDb as any, "user-upgraded");
      expect(mode).toBe("full");
    });

    it("defaults to 'public' when no account record is found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      const mode = await getUserAccessMode(mockDb as any, "user-not-found");
      expect(mode).toBe("public");
    });
  });
});
