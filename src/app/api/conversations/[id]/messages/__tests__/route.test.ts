import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "../route";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/app/components/workspace/types";

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

vi.mock("@/db/db", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

describe("Conversations [id] Messages API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/conversations/[id]/messages", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/conversations/c-1/messages");
      const res = await GET(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(401);
    });

    it("returns 404 when conversation does not exist or belong to user", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1/messages");
      const res = await GET(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(404);
    });

    it("returns messages ordered by createdAt", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "c-1", userId: "user-1" }]),
          }),
        }),
      });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([{ id: "m-1", content: "Hello" }]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1/messages");
      const res = await GET(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].content).toBe("Hello");
    });
  });

  describe("PATCH /api/conversations/[id]/messages", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const req = new Request("http://localhost/api/conversations/c-1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: "m-1", content: "Updated message" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid body or empty content", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "c-1", userId: "user-1" }]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: "m-1", content: "   " }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(400);
    });

    it("returns 400 when message content exceeds MAX_CHAT_MESSAGE_LENGTH", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "c-1", userId: "user-1" }]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1/messages", {
        method: "PATCH",
        body: JSON.stringify({
          messageId: "m-1",
          content: "a".repeat(MAX_CHAT_MESSAGE_LENGTH + 1),
        }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Message exceeds maximum allowed length");
    });

    it("returns 404 when message is not found or not editable", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "c-1", userId: "user-1" }]),
          }),
        }),
      });
      mockUpdate.mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: "m-1", content: "Updated prompt" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(404);
    });

    it("updates and returns edited user message", async () => {
      mockGetSession.mockResolvedValueOnce({ user: { id: "user-1" } });
      mockSelect.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "c-1", userId: "user-1" }]),
          }),
        }),
      });
      const updatedRow = { id: "m-1", content: "Updated prompt", role: "user" };
      mockUpdate.mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([updatedRow]),
          }),
        }),
      });

      const req = new Request("http://localhost/api/conversations/c-1/messages", {
        method: "PATCH",
        body: JSON.stringify({ messageId: "m-1", content: "Updated prompt" }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "c-1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.content).toBe("Updated prompt");
    });
  });
});
