import { describe, it, expect, vi } from "vitest";
import {
  getUserAccessMode,
  assertPublicAccessAllowed,
  getAccessModeFromScopes,
  PublicAccessRestrictedError,
  GITHUB_ACCESS_SCOPES,
} from "../accessMode";

describe("Cross-Mode Authorization & Scope Upgrades", () => {
  it("enforces Public-only mode: permits public repos and blocks private repos", () => {
    const scopes = GITHUB_ACCESS_SCOPES.public;
    const mode = getAccessModeFromScopes(scopes);

    expect(mode).toBe("public");
    expect(() => assertPublicAccessAllowed(false, mode)).not.toThrow();
    expect(() => assertPublicAccessAllowed(true, mode)).toThrow(
      PublicAccessRestrictedError,
    );
  });

  it("enforces Full access mode: permits both public and private repos", () => {
    const scopes = GITHUB_ACCESS_SCOPES.full;
    const mode = getAccessModeFromScopes(scopes);

    expect(mode).toBe("full");
    expect(() => assertPublicAccessAllowed(false, mode)).not.toThrow();
    expect(() => assertPublicAccessAllowed(true, mode)).not.toThrow();
  });

  it("handles upgrade lifecycle from Public-only to Full access", async () => {
    // Stage 1: User initially authenticates with public-only scopes
    let userScope = "public_repo,read:user";
    const mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(async () => [
              { scope: userScope, grantedScope: null },
            ]),
          }),
        }),
      })),
    };

    let activeMode = await getUserAccessMode(mockDb as any, "user-upgrade-test");
    expect(activeMode).toBe("public");
    expect(() => assertPublicAccessAllowed(true, activeMode)).toThrow(
      PublicAccessRestrictedError,
    );

    // Stage 2: User completes OAuth upgrade flow; account record updated with full scopes
    userScope = "repo,read:org";
    activeMode = await getUserAccessMode(mockDb as any, "user-upgrade-test");
    expect(activeMode).toBe("full");
    expect(() => assertPublicAccessAllowed(true, activeMode)).not.toThrow();
  });

  it("handles scope downgrade if user re-consents with minimal scopes", async () => {
    let userScope = "repo,read:org";
    const mockDb = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(async () => [
              { scope: userScope, grantedScope: null },
            ]),
          }),
        }),
      })),
    };

    let activeMode = await getUserAccessMode(mockDb as any, "user-downgrade-test");
    expect(activeMode).toBe("full");

    // Downgrade occurred
    userScope = "public_repo,read:user";
    activeMode = await getUserAccessMode(mockDb as any, "user-downgrade-test");
    expect(activeMode).toBe("public");
    expect(() => assertPublicAccessAllowed(true, activeMode)).toThrow(
      PublicAccessRestrictedError,
    );
  });

  it("resists client tampering: relies exclusively on database account scope", async () => {
    // Client claims 'full' access in request or state, but server DB has only public_repo
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

    // Even if client claims "full", server query determines real mode
    const serverVerifiedMode = await getUserAccessMode(mockDb as any, "user-attacker");
    expect(serverVerifiedMode).toBe("public");
    expect(() => assertPublicAccessAllowed(true, serverVerifiedMode)).toThrow(
      PublicAccessRestrictedError,
    );
  });
});
