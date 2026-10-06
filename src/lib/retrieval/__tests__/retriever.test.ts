import { describe, it, expect, vi } from "vitest";

import { retrieveChunks } from "../retriever";
import type { Database } from "@/db/db";

const fixtureRows = [
  {
    id: "chunk-1",
    repositoryId: "repo-123",
    filePath: "src/index.ts",
    language: "typescript",
    chunkType: "function",
    symbolName: "main",
    startLine: 1,
    endLine: 10,
    text: "console.log('hello')",
    similarity: 0.85,
  },
];

/**
 * Builds a plain-object database handle stub exposing both Drizzle fluent chains used by
 * `retrieveChunks`: the repository provider lookup (select -> from -> where -> limit) and the
 * chunk query (select -> from -> where -> orderBy -> limit).
 */
function createDbStub(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ limit, orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const db = { select } as unknown as Database;
  return { db, select, from, where, orderBy, limit };
}

describe("retrieveChunks", () => {
  it("queries via the injected database handle and returns results", async () => {
    const stub = createDbStub(fixtureRows);

    const results = await retrieveChunks("repo-123", [0.1, 0.2, 0.3], 5, stub.db);

    expect(results).toEqual(fixtureRows);
    // 1 call to lookup repository embeddingProvider + 1 call to query vector chunks
    expect(stub.select).toHaveBeenCalledTimes(2);
    expect(stub.limit).toHaveBeenCalledWith(5);
  });

  it("defaults topK to 5 when omitted", async () => {
    const stub = createDbStub([]);

    const results = await retrieveChunks("repo-456", [0.4, 0.5], undefined, stub.db);

    expect(results).toEqual([]);
    expect(stub.limit).toHaveBeenCalledWith(5);
  });

  it("fuses vector and lexical results using Reciprocal Rank Fusion", async () => {
    const { fuseHybridResults } = await import("../retriever");

    const vecChunk1 = {
      id: "chunk-v1",
      repositoryId: "repo-1",
      filePath: "src/a.ts",
      language: "typescript",
      chunkType: "function",
      symbolName: "alpha",
      startLine: 1,
      endLine: 10,
      text: "alpha function",
      similarity: 0.9,
    };
    const vecChunk2 = {
      id: "chunk-v2",
      repositoryId: "repo-1",
      filePath: "src/b.ts",
      language: "typescript",
      chunkType: "function",
      symbolName: "beta",
      startLine: 1,
      endLine: 10,
      text: "beta function",
      similarity: 0.8,
    };

    const lexChunk1 = {
      id: "chunk-l1",
      repositoryId: "repo-1",
      filePath: "src/c.ts",
      language: "typescript",
      chunkType: "function",
      symbolName: "targetSymbol",
      startLine: 1,
      endLine: 10,
      text: "targetSymbol function",
      similarity: 10.0,
    };

    // lexChunk1 matches exact query text "targetSymbol"
    const fused = fuseHybridResults([vecChunk1, vecChunk2], [lexChunk1, vecChunk1], 3, {
      queryText: "targetSymbol",
      k: 60,
    });

    expect(fused.length).toBe(3);
    // lexChunk1 has exact symbol boost, ranking it first
    expect(fused[0].id).toBe("chunk-l1");
    // vecChunk1 appears in both vector and lexical results, giving it combined RRF score
    expect(fused[1].id).toBe("chunk-v1");
  });
});

