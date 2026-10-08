import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

const mockAssertAssociation = vi.fn();
vi.mock("@/lib/access/repositoryAccess", () => ({
  assertRepositoryAssociation: (...args: any[]) => mockAssertAssociation(...args),
}));

const mockSelect = vi.fn();
vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
  },
}));

describe("GET /api/repos/[id]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/repos/repo-1/status");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(401);
  });

  it("returns 403 if user does not own association to repository", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(false);

    const request = new Request("http://localhost/api/repos/repo-1/status");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(403);
  });

  it("returns repository status with filesIndexed and chunksCount metadata", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    // 1. Repo lookup
    // 2. filesCount lookup
    // 3. chunksCount lookup
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              limit: vi.fn().mockResolvedValue([
                {
                  id: "repo-1",
                  embeddingStatus: "ready",
                  indexedAt: "2026-09-27T00:00:00.000Z",
                  defaultBranch: "main",
                  primaryLanguage: "TypeScript",
                  headCommitSha: "deadbeef",
                  syncStatus: "ready",
                },
              ]),
            };
          }
          if (callIndex === 2) {
            return Promise.resolve([{ count: 25 }]);
          }
          return Promise.resolve([{ count: 120 }]);
        }),
      }),
    }));

    const request = new Request("http://localhost/api/repos/repo-1/status");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe("repo-1");
    expect(data.embeddingStatus).toBe("ready");
    expect(data.stage).toBe("ready");
    expect(data.defaultBranch).toBe("main");
    expect(data.primaryLanguage).toBe("TypeScript");
    expect(data.headCommitSha).toBe("deadbeef");
    expect(data.filesIndexed).toBe(25);
    expect(data.chunksCount).toBe(120);
  });

  it("returns honest stage 'indexing' and 'preparing' during ongoing processing", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockAssertAssociation.mockResolvedValueOnce(true);

    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex === 1) {
            return {
              limit: vi.fn().mockResolvedValue([
                {
                  id: "repo-1",
                  embeddingStatus: "processing",
                  indexedAt: null,
                  defaultBranch: "main",
                  primaryLanguage: "TypeScript",
                  headCommitSha: "deadbeef",
                  syncStatus: "ready",
                },
              ]),
            };
          }
          if (callIndex === 2) {
            return Promise.resolve([{ count: 10, totalSizeBytes: "10240" }]);
          }
          if (callIndex === 3) {
            return Promise.resolve([{ count: 0 }]);
          }
          return Promise.resolve([{ count: 0 }]);
        }),
      }),
    }));

    const request = new Request("http://localhost/api/repos/repo-1/status");
    const response = await GET(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.embeddingStatus).toBe("processing");
    expect(data.stage).toBe("indexing");
    expect(data.filesIndexed).toBe(10);
    expect(data.totalSizeBytes).toBe(10240);
  });
});
