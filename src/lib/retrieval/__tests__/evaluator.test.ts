import { describe, it, expect } from "vitest";
import { evaluateRetrieval, isRelevant, formatEvalReport } from "../eval/evaluator";
import { RETRIEVAL_EVAL_DATASET } from "../eval/dataset";
import { buildBenchmarkCorpus } from "../eval/benchmarkCorpus";
import { searchVectorBaseline, searchHybridBenchmark } from "../eval/runEval";
import type { RetrievedChunk } from "../retriever";

describe("Retrieval Evaluator Metrics", () => {
  it("correctly identifies relevant chunks by file and symbol match", () => {
    const query = {
      id: "test-q1",
      query: "isSensitiveFile",
      category: "function" as const,
      expectedFiles: ["src/lib/ingestion/fileFilter.ts"],
      expectedSymbols: ["isSensitiveFile"],
    };

    expect(
      isRelevant(
        { filePath: "src/lib/ingestion/fileFilter.ts", symbolName: "isSensitiveFile" },
        query,
      ),
    ).toBe(true);

    expect(
      isRelevant(
        { filePath: "src/lib/ingestion/fileFilter.ts", symbolName: "otherSymbol" },
        query,
      ),
    ).toBe(false);

    expect(
      isRelevant(
        { filePath: "src/lib/other/file.ts", symbolName: "isSensitiveFile" },
        query,
      ),
    ).toBe(false);
  });

  it("calculates Hit@1, Hit@3, Hit@5 and MRR accurately", () => {
    const queries = [
      {
        id: "q1",
        query: "test1",
        category: "function" as const,
        expectedFiles: ["fileA.ts"],
      },
      {
        id: "q2",
        query: "test2",
        category: "function" as const,
        expectedFiles: ["fileB.ts"],
      },
      {
        id: "q3",
        query: "test3",
        category: "function" as const,
        expectedFiles: ["fileC.ts"],
      },
    ];

    const makeChunk = (filePath: string): RetrievedChunk => ({
      id: filePath,
      repositoryId: "repo",
      filePath,
      language: "typescript",
      chunkType: "block",
      symbolName: null,
      startLine: 1,
      endLine: 10,
      text: "code",
      similarity: 0.9,
    });

    const results = new Map<string, RetrievedChunk[]>([
      // q1: relevant at rank 1
      ["q1", [makeChunk("fileA.ts"), makeChunk("fileX.ts")]],
      // q2: relevant at rank 3
      ["q2", [makeChunk("fileX.ts"), makeChunk("fileY.ts"), makeChunk("fileB.ts")]],
      // q3: no hit in top 5
      ["q3", [makeChunk("fileX.ts"), makeChunk("fileY.ts")]],
    ]);

    const metrics = evaluateRetrieval(queries, results);

    // Hit@1: 1 out of 3 = 1/3 (~33.3%)
    expect(metrics.hitAt1Count).toBe(1);
    expect(metrics.hitAt1).toBeCloseTo(1 / 3, 2);

    // Hit@3: 2 out of 3 = 2/3 (~66.7%)
    expect(metrics.hitAt3Count).toBe(2);
    expect(metrics.hitAt3).toBeCloseTo(2 / 3, 2);

    // Hit@5: 2 out of 3 = 2/3 (~66.7%)
    expect(metrics.hitAt5Count).toBe(2);
    expect(metrics.hitAt5).toBeCloseTo(2 / 3, 2);

    // MRR: (1/1 + 1/3 + 0) / 3 = (4/3) / 3 = 4/9 (~0.4444)
    expect(metrics.mrr).toBeCloseTo(4 / 9, 3);

    const report = formatEvalReport("Test Report", metrics);
    expect(report).toContain("Hit@1");
    expect(report).toContain("MRR");
  });

  it("evaluates benchmark corpus and verifies hybrid outperforms baseline", () => {
    const corpus = buildBenchmarkCorpus();
    expect(corpus.length).toBeGreaterThan(20);

    const baselineResults = new Map<string, RetrievedChunk[]>();
    const hybridResults = new Map<string, RetrievedChunk[]>();

    for (const q of RETRIEVAL_EVAL_DATASET) {
      baselineResults.set(q.id, searchVectorBaseline(corpus, q.query, 5));
      hybridResults.set(q.id, searchHybridBenchmark(corpus, q.query, 5));
    }

    const baseline = evaluateRetrieval(RETRIEVAL_EVAL_DATASET, baselineResults);
    const hybrid = evaluateRetrieval(RETRIEVAL_EVAL_DATASET, hybridResults);

    // Hybrid should significantly improve Hit@1 and MRR over vector-only baseline
    expect(hybrid.hitAt1).toBeGreaterThan(baseline.hitAt1);
    expect(hybrid.mrr).toBeGreaterThan(baseline.mrr);
    expect(hybrid.hitAt1).toBeGreaterThanOrEqual(0.6);
    expect(hybrid.mrr).toBeGreaterThanOrEqual(0.6);
  });
});
