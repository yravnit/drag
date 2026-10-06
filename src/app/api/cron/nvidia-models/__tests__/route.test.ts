import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";

const mockRefreshNvidiaModels = vi.fn();
vi.mock("@/lib/nvidia/nvidiaModelService", () => ({
  refreshNvidiaModels: (...args: any[]) => mockRefreshNvidiaModels(...args),
}));

vi.mock("@/db/db", () => ({
  db: {},
}));

vi.mock("@/data/serverEnv", () => ({
  serverEnv: {
    NVIDIA_API_KEY: "nvapi-secret-key-12345",
  },
}));

describe("GET /api/cron/nvidia-models", () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it("rejects unauthorized cron requests in production when token is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.CRON_SECRET = "super-secret-cron-token";

    const request = new Request("http://localhost/api/cron/nvidia-models");
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockRefreshNvidiaModels).not.toHaveBeenCalled();
  });

  it("rejects unauthorized cron requests in production when token is mismatched", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.CRON_SECRET = "super-secret-cron-token";

    const request = new Request("http://localhost/api/cron/nvidia-models", {
      headers: {
        Authorization: "Bearer wrong-secret-token",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mockRefreshNvidiaModels).not.toHaveBeenCalled();
  });

  it("accepts authorized cron request with valid bearer token and executes refresh", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.CRON_SECRET = "super-secret-cron-token";

    mockRefreshNvidiaModels.mockResolvedValueOnce({
      success: true,
      totalDiscovered: 12,
      candidatesProbed: 5,
      availableCount: 3,
    });

    const request = new Request("http://localhost/api/cron/nvidia-models", {
      headers: {
        Authorization: "Bearer super-secret-cron-token",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.availableCount).toBe(3);
    expect(mockRefreshNvidiaModels).toHaveBeenCalledTimes(1);

    // Verify NVIDIA_API_KEY is NEVER exposed in the JSON response
    const jsonString = JSON.stringify(data);
    expect(jsonString).not.toContain("nvapi-secret-key-12345");
  });

  it("returns 500 when refresh throws an unexpected error", async () => {
    delete process.env.CRON_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    mockRefreshNvidiaModels.mockRejectedValueOnce(new Error("Network connection failed"));

    const request = new Request("http://localhost/api/cron/nvidia-models");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to refresh NVIDIA models");
  });
});
