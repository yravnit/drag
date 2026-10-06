import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isNonChatModel,
  filterNvidiaChatCandidates,
  probeNvidiaChatModel,
  refreshNvidiaModels,
  getPersistedNvidiaModels,
} from "../nvidiaModelService";

describe("NVIDIA Model Availability Service", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("1. Non-chat model detection (isNonChatModel)", () => {
    it("identifies obvious embedding, rerank, parse, guard, and safety models by id", () => {
      expect(isNonChatModel("nvidia/nv-embedqa-e5-v5")).toBe(true);
      expect(isNonChatModel("nvidia/llama-3.2-nv-rerankqa-1b-v2")).toBe(true);
      expect(isNonChatModel("nvidia/document-parse-v1")).toBe(true);
      expect(isNonChatModel("nvidia/llama-guard-3-8b")).toBe(true);
      expect(isNonChatModel("nvidia/safety-checker")).toBe(true);
      expect(isNonChatModel("nvidia/riva-translate-4b-instruct-v2")).toBe(true);
      expect(isNonChatModel("nvidia/ising-calibration-1.5-31b")).toBe(true);
      expect(isNonChatModel("nvidia/ai-synthetic-video-detector")).toBe(true);
      expect(isNonChatModel("nvidia/nvclip")).toBe(true);
    });

    it("identifies non-chat models from metadata attributes (type / pipeline_tag)", () => {
      expect(isNonChatModel("nvidia/custom-model", { type: "text-embeddings" })).toBe(true);
      expect(isNonChatModel("nvidia/custom-model", { pipeline_tag: "reranking" })).toBe(true);
      expect(isNonChatModel("nvidia/custom-model", { type: "guardrail" })).toBe(true);
      expect(isNonChatModel("nvidia/custom-model", { type: "translation" })).toBe(true);
    });

    it("accepts valid chat LLMs across providers", () => {
      expect(isNonChatModel("nvidia/llama-3.1-nemotron-70b-instruct")).toBe(false);
      expect(isNonChatModel("meta/llama-3.2-11b-vision-instruct")).toBe(false);
      expect(isNonChatModel("poolside/laguna-xs-2.1")).toBe(false);
      expect(isNonChatModel("openai/gpt-oss-20b")).toBe(false);
      expect(isNonChatModel("nvidia/nemotron-3.5-lightning-30b-a3b")).toBe(false);
      expect(isNonChatModel("nvidia/nemotron-3-super-120b-a12b")).toBe(false);
    });
  });

  describe("2. Candidate filtering (filterNvidiaChatCandidates)", () => {
    it("filters out obvious non-chat models while supporting all LLM providers", () => {
      const rawCandidates = [
        { id: "nvidia/llama-3.1-nemotron-70b-instruct" },
        { id: "meta/llama-3.2-11b-vision-instruct" },
        { id: "poolside/laguna-xs-2.1" },
        { id: "openai/gpt-oss-20b" },
        { id: "nvidia/riva-translate-4b-instruct-v2" }, // Translation
        { id: "nvidia/ising-calibration-1.5-31b" }, // Calibration
        { id: "nvidia/nv-embedqa-e5-v5" }, // Embedding
        { id: "nvidia/rerank-qa-mistral-4b" }, // Rerank
        { id: "not-a-namespaced-model" }, // Missing provider namespace
      ];

      const filtered = filterNvidiaChatCandidates(rawCandidates);
      expect(filtered).toHaveLength(4);
      expect(filtered.map((m) => m.id)).toEqual([
        "nvidia/llama-3.1-nemotron-70b-instruct",
        "meta/llama-3.2-11b-vision-instruct",
        "poolside/laguna-xs-2.1",
        "openai/gpt-oss-20b",
      ]);
    });
  });

  describe("3. Real inference probe (probeNvidiaChatModel)", () => {
    it("handles reasoning models where content is null and tokens are in reasoning_content", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                reasoning_content: "The user requested OK",
              },
            },
          ],
        }),
      });

      const result = await probeNvidiaChatModel("nvidia/nemotron-3-super-120b-a12b", "test-key");
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.modelId).toBe("nvidia/nemotron-3-super-120b-a12b");
    });

    it("handles successful probe with valid JSON and assistant content", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { role: "assistant", content: "OK" },
            },
          ],
        }),
      });

      const result = await probeNvidiaChatModel("nvidia/llama-3.1-nemotron-70b-instruct", "test-key");
      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.modelId).toBe("nvidia/llama-3.1-nemotron-70b-instruct");
    });

    it("handles 404 Not Found error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await probeNvidiaChatModel("nvidia/nonexistent-model", "test-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP error 404");
    });

    it("handles 410 Gone error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
        statusText: "Gone",
      });

      const result = await probeNvidiaChatModel("nvidia/deprecated-model", "test-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP error 410");
    });

    it("handles request timeout via AbortController", async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      });

      const result = await probeNvidiaChatModel("nvidia/slow-model", "test-key", { timeoutMs: 100 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Request timed out");
    });

    it("handles malformed JSON response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      });

      const result = await probeNvidiaChatModel("nvidia/broken-json-model", "test-key");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Malformed JSON response");
    });

    it("handles missing assistant response in choices payload", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [],
        }),
      });

      const result = await probeNvidiaChatModel("nvidia/empty-choices-model", "test-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing or empty assistant response");
    });

    it("handles empty string assistant response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "   " } }],
        }),
      });

      const result = await probeNvidiaChatModel("nvidia/whitespace-model", "test-key");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing or empty assistant response");
    });
  });

  describe("4. Refresh and failure behavior (refreshNvidiaModels)", () => {
    it("persists mixed successful and failed candidates without aborting", async () => {
      const insertedRows: any[] = [];
      const retired: any[] = [];
      const fakeDb: any = {
        insert: () => ({
          values: (row: any) => ({
            onConflictDoUpdate: ({ set }: any) => {
              insertedRows.push({ ...row, ...set });
              return Promise.resolve();
            },
          }),
        }),
        update: () => ({
          set: (values: any) => ({
            where: () => {
              retired.push(values);
              return Promise.resolve();
            },
          }),
        }),
      };

      // Mock discovery response with 4 candidates
      // A: available
      // B: 410
      // C: timeout
      // D: available
      let probeCallCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/v1/models")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "nvidia/model-a" },
                { id: "nvidia/model-b" },
                { id: "nvidia/model-c" },
                { id: "nvidia/model-d" },
              ],
            }),
          });
        }

        probeCallCount++;
        if (probeCallCount === 1) {
          // Model A: available
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: "OK" } }],
            }),
          });
        } else if (probeCallCount === 2) {
          // Model B: 410
          return Promise.resolve({
            ok: false,
            status: 410,
            statusText: "Gone",
          });
        } else if (probeCallCount === 3) {
          // Model C: timeout
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          return Promise.reject(err);
        } else {
          // Model D: available
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: "OK" } }],
            }),
          });
        }
      });

      const refreshResult = await refreshNvidiaModels(fakeDb, "test-api-key");
      expect(refreshResult.success).toBe(true);
      expect(refreshResult.candidatesProbed).toBe(4);
      expect(refreshResult.availableCount).toBe(2);

      expect(insertedRows).toHaveLength(4);
      const modelA = insertedRows.find((r) => r.modelId === "nvidia/model-a");
      const modelB = insertedRows.find((r) => r.modelId === "nvidia/model-b");
      const modelC = insertedRows.find((r) => r.modelId === "nvidia/model-c");
      const modelD = insertedRows.find((r) => r.modelId === "nvidia/model-d");

      expect(modelA?.status).toBe("available");
      expect(modelB?.status).toBe("unavailable");
      expect(modelC?.status).toBe("unavailable");
      expect(modelD?.status).toBe("available");
    });

    it("retires available models that are no longer listed by discovery", async () => {
      const retired: any[] = [];
      const fakeDb: any = {
        insert: () => ({
          values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
        }),
        update: () => ({
          set: (values: any) => ({
            where: () => {
              retired.push(values);
              return Promise.resolve();
            },
          }),
        }),
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/v1/models")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: "nvidia/only-model-left" }] }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "OK" } }] }),
        });
      });

      await refreshNvidiaModels(fakeDb, "test-api-key");

      expect(retired).toHaveLength(1);
      expect(retired[0].status).toBe("unavailable");
      expect(retired[0].latencyMs).toBeNull();
      expect(retired[0].lastError).toContain("No longer listed");
    });

    it("passes an abort signal to the discovery request", async () => {
      const seen: any[] = [];
      const fakeDb: any = {
        insert: () => ({
          values: () => ({ onConflictDoUpdate: () => Promise.resolve() }),
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      };

      global.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
        if (url.includes("/v1/models")) {
          seen.push(opts?.signal);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ choices: [] }) });
      });

      await refreshNvidiaModels(fakeDb, "test-api-key");

      expect(seen[0]).toBeDefined();
      expect(seen[0]).toBeInstanceOf(AbortSignal);
    });

    it("retains previous known-good results when entire discovery fails", async () => {
      const fakeDb: any = {
        insert: vi.fn(),
      };

      global.fetch = vi.fn().mockRejectedValue(new Error("NVIDIA API 500 Internal Server Error"));

      const refreshResult = await refreshNvidiaModels(fakeDb, "test-api-key");
      expect(refreshResult.success).toBe(false);
      expect(refreshResult.error).toContain("Discovery request failed");
      // Does not wipe existing database entries
      expect(fakeDb.insert).not.toHaveBeenCalled();
    });

    it("returns error immediately when NVIDIA_API_KEY is missing", async () => {
      const fakeDb: any = {};
      const refreshResult = await refreshNvidiaModels(fakeDb, "");
      expect(refreshResult.success).toBe(false);
      expect(refreshResult.error).toBe("NVIDIA_API_KEY is not configured");
    });
  });

  describe("5. Querying usable models (getPersistedNvidiaModels)", () => {
    it("returns only currently usable NVIDIA models from database", async () => {
      const now = new Date("2026-09-27T10:00:00Z");
      const fakeDb: any = {
        select: () => ({
          from: () => ({
            where: () => [
              {
                modelId: "nvidia/llama-3.1-nemotron-70b-instruct",
                status: "available",
                latencyMs: 382,
                lastCheckedAt: now,
              },
              {
                modelId: "nvidia/nemotron-mini-4b-instruct",
                status: "available",
                latencyMs: 145,
                lastCheckedAt: now,
              },
            ],
          }),
        }),
      };

      const result = await getPersistedNvidiaModels(fakeDb);
      expect(result.provider).toBe("nvidia");
      expect(result.checkedAt).toBe(now.toISOString());
      expect(result.models).toEqual([
        { id: "nvidia/llama-3.1-nemotron-70b-instruct", latencyMs: 382 },
        { id: "nvidia/nemotron-mini-4b-instruct", latencyMs: 145 },
      ]);
    });

    it("does NOT execute network requests when reading persisted models", async () => {
      const fakeDb: any = {
        select: () => ({
          from: () => ({
            where: () => [],
          }),
        }),
      };

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      await getPersistedNvidiaModels(fakeDb);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("propagates database read failures instead of reporting an empty model list", async () => {
      const fakeDb: any = {
        select: () => {
          throw new Error("Database connection lost");
        },
      };

      // A failed read must not be indistinguishable from "no verified models"
      await expect(getPersistedNvidiaModels(fakeDb)).rejects.toThrow(
        /Database connection lost/,
      );
    });
  });
});
