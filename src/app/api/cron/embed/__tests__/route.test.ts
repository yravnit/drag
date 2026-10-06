import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import { start } from "workflow/api";

const mockSelectDistinct = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/db/db", () => ({
  db: {
    selectDistinct: (...args: any[]) => mockSelectDistinct(...args),
  },
}));

// Wire up the chained query builder
function setupQueryChain(result: any[]) {
  mockSelectDistinct.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue(result);
}

vi.mock("@/db/schema", () => ({
  chunks: { repositoryId: "chunks_repositoryId", embedding: "chunks_embedding" },
  repositories: {
    id: "repositories_id",
    embeddingStatus: "repositories_embeddingStatus",
    embeddingLeaseExpiresAt: "repositories_embeddingLeaseExpiresAt",
    updatedAt: "repositories_updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  isNull: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  ne: vi.fn(),
  lt: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/workflows/embed", () => ({
  embedRepository: vi.fn(),
}));

describe("GET /api/cron/embed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 message when no pending repositories are found", async () => {
    setupQueryChain([]);

    const request = new Request("http://localhost");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.message).toBe("No pending embeddings to process");
    expect(data.triggered).toEqual([]);
  });

  it("finds eligible repositories and starts workflows for each", async () => {
    setupQueryChain([{ id: "repo-1" }, { id: "repo-2" }]);
    vi.mocked(start).mockResolvedValue({ runId: "run-1" } as any);

    const request = new Request("http://localhost");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.runs).toHaveLength(2);
    expect(data.runs[0]).toEqual({ repositoryId: "repo-1", runId: "run-1" });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("handles startup failures on individual repos and continues with the rest", async () => {
    setupQueryChain([{ id: "repo-fail" }, { id: "repo-success" }]);

    vi.mocked(start)
      .mockRejectedValueOnce(new Error("Startup error"))
      .mockResolvedValueOnce({ runId: "run-success" } as any);

    const request = new Request("http://localhost");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].repositoryId).toBe("repo-success");
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0]).toEqual({
      repositoryId: "repo-fail",
      error: "Startup error",
    });
  });
});
