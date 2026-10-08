import { describe, it, expect } from "vitest";
import { clientEnv } from "../clientEnv";
import { serverEnv } from "../serverEnv";

describe("Deployment Environment & Secrets Audit (5A)", () => {
  it("exposes zero client environment variables to avoid leaking secrets in client bundles", () => {
    // clientEnv must contain 0 keys
    expect(Object.keys(clientEnv)).toHaveLength(0);
  });

  it("defines all required production server environment variables", () => {
    expect(serverEnv.DATABASE_URL).toBeDefined();
    expect(typeof serverEnv.DATABASE_URL).toBe("string");
    expect(serverEnv.DATABASE_URL).toContain("://");

    expect(serverEnv.BETTER_AUTH_SECRET).toBeDefined();
    expect(serverEnv.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);

    expect(serverEnv.BETTER_AUTH_URL).toBeDefined();
    expect(serverEnv.GITHUB_CLIENT_ID).toBeDefined();
    expect(serverEnv.GITHUB_CLIENT_SECRET).toBeDefined();
  });

  it("locks embedding dimensions strictly to 768 to match the PostgreSQL vector schema", () => {
    expect(serverEnv.EMBEDDING_DIMENSIONS).toBe(768);
  });

  it("configures valid LLM endpoints", () => {
    expect(serverEnv.LLM_BASE_URL).toMatch(/^https?:\/\//);
    expect(serverEnv.LLM_MODEL).toBe("minimaxai/minimax-m3");
  });
});
