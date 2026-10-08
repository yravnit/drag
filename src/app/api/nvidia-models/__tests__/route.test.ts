import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

vi.mock("@/db/db", () => ({
  db: {},
}));

const mockGetPersistedNvidiaModels = vi.fn();
vi.mock("@/lib/nvidia/nvidiaModelService", () => ({
  getPersistedNvidiaModels: (...args: any[]) => mockGetPersistedNvidiaModels(...args),
}));

describe("GET /api/nvidia-models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with currently usable NVIDIA models", async () => {
    mockGetPersistedNvidiaModels.mockResolvedValueOnce({
      provider: "nvidia",
      checkedAt: "2026-09-27T10:00:00.000Z",
      models: [
        { id: "nvidia/llama-3.1-nemotron-70b-instruct", latencyMs: 380 },
        { id: "nvidia/nemotron-mini-4b-instruct", latencyMs: 120 },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.provider).toBe("nvidia");
    expect(data.checkedAt).toBe("2026-09-27T10:00:00.000Z");
    expect(data.models).toHaveLength(2);
    expect(data.models[0]).toEqual({
      id: "nvidia/llama-3.1-nemotron-70b-instruct",
      latencyMs: 380,
    });
  });

  it("returns 200 with empty list when no models are verified", async () => {
    mockGetPersistedNvidiaModels.mockResolvedValueOnce({
      provider: "nvidia",
      checkedAt: null,
      models: [],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.provider).toBe("nvidia");
    expect(data.checkedAt).toBeNull();
    expect(data.models).toEqual([]);
  });

  it("returns 500 when database read fails", async () => {
    mockGetPersistedNvidiaModels.mockRejectedValueOnce(new Error("Database connection lost"));

    const res = await GET();
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toBe("Failed to fetch NVIDIA models");
  });
});
