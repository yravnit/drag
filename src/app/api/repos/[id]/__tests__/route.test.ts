import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "../route";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockSelect = vi.fn();

vi.mock("@/db/db", () => ({
  db: {
    delete: vi.fn(() => ({
      where: (...args: any[]) => mockDeleteWhere(...args),
    })),
    select: (...args: any[]) => mockSelect(...args),
  },
}));

const mockInvalidateCache = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/access/repositoryAccess", () => ({
  invalidateRepositoryAccessCache: (...args: any[]) => mockInvalidateCache(...args),
}));

describe("DELETE /api/repos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/repos/repo-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(401);
    expect(mockInvalidateCache).not.toHaveBeenCalled();
  });

  it("removes association and invalidates access cache", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ value: 1 }]), // 1 other association exists
      }),
    });

    const request = new Request("http://localhost/api/repos/repo-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "repo-1" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    expect(mockInvalidateCache).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "repo-1",
    );
  });
});
