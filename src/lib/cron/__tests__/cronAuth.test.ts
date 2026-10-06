import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureCronAuthorized, isCronAuthorized } from "../cronAuth";

describe("isCronAuthorized", () => {
  let originalCronSecret: string | undefined;

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("fails closed when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    const request = new Request("http://localhost/api/cron/embed", {
      headers: {
        Authorization: "Bearer testsecret",
      },
    });
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("fails closed when Authorization header is missing", () => {
    process.env.CRON_SECRET = "testsecret";
    const request = new Request("http://localhost/api/cron/embed");
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("fails closed when Authorization header has length mismatch", () => {
    process.env.CRON_SECRET = "testsecret";
    const request = new Request("http://localhost/api/cron/embed", {
      headers: {
        Authorization: "Bearer short",
      },
    });
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("fails closed when bearer token is mismatched but same length", () => {
    process.env.CRON_SECRET = "testsecret";
    const request = new Request("http://localhost/api/cron/embed", {
      headers: {
        Authorization: "Bearer wrongsecr", // same length as "Bearer testsecret"
      },
    });
    expect(isCronAuthorized(request)).toBe(false);
  });

  it("accepts a valid bearer token matching CRON_SECRET", () => {
    process.env.CRON_SECRET = "testsecret";
    const request = new Request("http://localhost/api/cron/embed", {
      headers: {
        Authorization: "Bearer testsecret",
      },
    });
    expect(isCronAuthorized(request)).toBe(true);
  });
});

describe("ensureCronAuthorized", () => {
  let originalCronSecret: string | undefined;

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
    vi.unstubAllEnvs();
  });

  it("accepts a valid bearer token in production", () => {
    process.env.CRON_SECRET = "testsecret";
    const request = new Request("http://localhost/api/cron/embed", {
      headers: {
        Authorization: "Bearer testsecret",
      },
    });
    expect(ensureCronAuthorized(request)).toBe(true);
  });

  it("rejects an invalid bearer token in production", () => {
    process.env.CRON_SECRET = "testsecret";
    const request = new Request("http://localhost/api/cron/embed", {
      headers: {
        Authorization: "Bearer wrongsecr",
      },
    });
    expect(ensureCronAuthorized(request)).toBe(false);
  });

  it("bypasses the secret check outside production even without CRON_SECRET", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.CRON_SECRET;
    const request = new Request("http://localhost/api/cron/embed");
    expect(ensureCronAuthorized(request)).toBe(true);
  });
});
