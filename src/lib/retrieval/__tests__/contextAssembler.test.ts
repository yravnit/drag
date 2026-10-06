import { describe, it, expect } from "vitest";
import {
  deduplicateRetrievedChunks,
  assembleContext,
} from "../contextAssembler";
import type { RetrievedChunk } from "../retriever";

describe("contextAssembler", () => {
  const makeChunk = (
    id: string,
    filePath: string,
    startLine: number,
    endLine: number,
    text: string,
    similarity = 0.9,
    symbolName: string | null = null,
  ): RetrievedChunk => ({
    id,
    repositoryId: "repo-1",
    filePath,
    language: "typescript",
    chunkType: "function_item",
    symbolName,
    startLine,
    endLine,
    text,
    similarity,
  });

  it("removes chunks with duplicate IDs", () => {
    const chunk1 = makeChunk("c1", "src/a.ts", 1, 20, "const a = 1;");
    const chunk2 = makeChunk("c1", "src/a.ts", 1, 20, "const a = 1;");

    const result = deduplicateRetrievedChunks([chunk1, chunk2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("deduplicates overlapping chunks from the same file, keeping higher ranked chunk", () => {
    // chunk1 covers lines 10 to 50
    const chunk1 = makeChunk("c1", "src/file.ts", 10, 50, "block 1", 0.95);
    // chunk2 covers lines 15 to 45 (subsumed inside chunk1)
    const chunk2 = makeChunk("c2", "src/file.ts", 15, 45, "block 2", 0.85);

    const result = deduplicateRetrievedChunks([chunk1, chunk2]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("preserves non-overlapping chunks from the same file", () => {
    const chunk1 = makeChunk("c1", "src/file.ts", 1, 30, "function one() {}", 0.95);
    const chunk2 = makeChunk("c2", "src/file.ts", 100, 140, "function two() {}", 0.85);

    const result = deduplicateRetrievedChunks([chunk1, chunk2]);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("preserves chunks from different files regardless of line numbers", () => {
    const chunkA = makeChunk("cA", "src/a.ts", 1, 30, "code A", 0.9);
    const chunkB = makeChunk("cB", "src/b.ts", 1, 30, "code B", 0.88);

    const result = deduplicateRetrievedChunks([chunkA, chunkB]);
    expect(result).toHaveLength(2);
  });

  it("assembles structured context and generates matching citations", () => {
    const chunks = [
      makeChunk("c1", "src/auth.ts", 10, 25, "export function login() {}", 0.9, "login"),
      makeChunk("c2", "src/db.ts", 50, 70, "export const db = {};", 0.8, "db"),
    ];

    const { contextString, citations, deduplicatedCount } = assembleContext(chunks);

    expect(deduplicatedCount).toBe(0);
    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      index: 1,
      filePath: "src/auth.ts",
      startLine: 10,
      endLine: 25,
      symbolName: "login",
      text: "export function login() {}",
    });
    expect(citations[1]).toEqual({
      index: 2,
      filePath: "src/db.ts",
      startLine: 50,
      endLine: 70,
      symbolName: "db",
      text: "export const db = {};",
    });

    expect(contextString).toContain("[Citation 1] File: src/auth.ts (Lines: 10-25, Symbol: login)");
    expect(contextString).toContain("[Citation 2] File: src/db.ts (Lines: 50-70, Symbol: db)");
  });

  it("bounds context assembly within maxTotalChars limit", () => {
    const chunk1 = makeChunk("c1", "src/large1.ts", 1, 100, "x".repeat(500));
    const chunk2 = makeChunk("c2", "src/large2.ts", 1, 100, "y".repeat(500));

    // Limit to 600 chars total
    const { citations } = assembleContext([chunk1, chunk2], { maxTotalChars: 600 });
    expect(citations).toHaveLength(1);
    expect(citations[0].filePath).toBe("src/large1.ts");
  });
});
