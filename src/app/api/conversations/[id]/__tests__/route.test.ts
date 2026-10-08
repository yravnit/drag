import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH, DELETE } from "../route";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

describe("Conversations [id] API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PATCH /api/conversations/[id]", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/conversations/c-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "New Name" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(401);
    });

    it("returns 400 for empty or invalid title", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

      const req = new Request("http://localhost/api/conversations/c-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "   " }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(400);
    });

    it("returns 400 when title exceeds 100 characters", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });

      const req = new Request("http://localhost/api/conversations/c-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "a".repeat(101) }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("100 characters");
    });

    it("returns 404 when conversation does not belong to user", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed Thread" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(404);
    });

    it("renames conversation when authenticated user owns it", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "c-1" }]),
          }),
        }),
      });

      mockUpdate.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "c-1", title: "Renamed Thread" }]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed Thread" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.title).toBe("Renamed Thread");
    });
  });

  describe("DELETE /api/conversations/[id]", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/conversations/c-1", { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(401);
    });

    it("returns 404 when conversation not found for user", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1", { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(404);
    });

    it("deletes conversation when authenticated user owns it", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "c-1" }]),
          }),
        }),
      });

      const mockWhere = vi.fn().mockResolvedValue(undefined);
      mockDelete.mockReturnValueOnce({
        where: mockWhere,
      });

      const req = new Request("http://localhost/api/conversations/c-1", { method: "DELETE" });
      const res = await DELETE(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });
  });
});
