import { describe, it, expect } from "vitest";
import {
  isE2EChunkRelevant,
  extractCitations,
  verifyCitations,
  evaluateAnswerQuality,
  evaluateE2ERag,
  formatE2EReport,
} from "../eval/e2eEvaluator";
import { E2E_RAG_EVAL_DATASET, type E2EEvalCase } from "../eval/e2eDataset";
import type { RetrievedChunk } from "../retriever";

describe("End-to-End RAG Evaluator", () => {
  const mockChunk = (overrides?: Partial<RetrievedChunk>): RetrievedChunk => ({
    id: "chunk-1",
    repositoryId: "repo-1",
    filePath: "src/lib/mermaid/sanitizeMermaid.ts",
    language: "typescript",
    chunkType: "function_item",
    symbolName: "sanitizeMermaidSvg",
    startLine: 1,
    endLine: 20,
    text: "export function sanitizeMermaidSvg(svg: string): string { return DOMPurify.sanitize(svg); }",
    similarity: 0.95,
    ...overrides,
  });

  const sampleCase: E2EEvalCase = {
    id: "test-mermaid",
    query: "How does sanitizeMermaidSvg sanitize diagrams?",
    category: "architecture",
    evidenceType: "full_evidence",
    expectedFiles: ["src/lib/mermaid/sanitizeMermaid.ts"],
    expectedSymbols: ["sanitizeMermaidSvg"],
    expectedConcepts: ["DOMPurify", "sanitize", "SVG"],
    requiredFacts: ["DOMPurify", "SVG"],
    forbiddenClaims: ["dangerouslySetInnerHTML", "eval"],
    description: "Sample test case",
  };

  it("extracts citation bracket numbers accurately", () => {
    expect(extractCitations("According to [1] and [3], the system is fast. See also [1].")).toEqual([1, 3]);
    expect(extractCitations("No citations here")).toEqual([]);
    expect(extractCitations("[10] is a two digit citation")).toEqual([10]);
  });

  it("determines chunk relevance based on expected files and symbols", () => {
    expect(isE2EChunkRelevant(mockChunk(), sampleCase)).toBe(true);

    expect(
      isE2EChunkRelevant(
        mockChunk({ filePath: "src/lib/other/file.ts" }),
        sampleCase,
      ),
    ).toBe(false);

    expect(
      isE2EChunkRelevant(
        mockChunk({ symbolName: "unrelatedSymbol" }),
        sampleCase,
      ),
    ).toBe(false);
  });

  it("verifies citation validity against retrieved chunks", () => {
    const chunks = [mockChunk()];

    // Valid citation pointing to chunk 1
    const validRes = verifyCitations([1], chunks, sampleCase);
    expect(validRes.valid).toBe(true);
    expect(validRes.reasons).toHaveLength(0);

    // Out of bounds citation
    const oobRes = verifyCitations([2], chunks, sampleCase);
    expect(oobRes.valid).toBe(false);
    expect(oobRes.reasons[0]).toContain("out of bounds");

    // Missing citations for full evidence case
    const missingRes = verifyCitations([], chunks, sampleCase);
    expect(missingRes.valid).toBe(false);
    expect(missingRes.reasons[0]).toContain("No citations provided");
  });

  it("flags answers containing forbidden claims", () => {
    const chunks = [mockChunk()];
    const answerWithForbidden = "It uses DOMPurify for SVG but also dangerouslySetInnerHTML without sanitization [1].";

    const res = evaluateAnswerQuality(answerWithForbidden, chunks, sampleCase);
    expect(res.grounded).toBe(false);
    expect(res.factuallyCorrect).toBe(false);
    expect(res.failureReasons.some((r) => r.includes("forbidden claim"))).toBe(true);
  });

  it("correctly evaluates insufficient evidence cases without hallucinations", () => {
    const noEvidenceCase: E2EEvalCase = {
      id: "test-no-redis",
      query: "How is Redis configured?",
      category: "architecture",
      evidenceType: "no_evidence",
      expectedFiles: [],
      expectedConcepts: ["no redis"],
      requiredFacts: ["cannot determine"],
      forbiddenClaims: ["Redis cluster is configured"],
      description: "No evidence test",
    };

    // Compliant answer stating lack of evidence
    const compliantAnswer = "I cannot determine this from the indexed repository. The codebase does not use Redis.";
    const compliantRes = evaluateAnswerQuality(compliantAnswer, [], noEvidenceCase);
    expect(compliantRes.handledInsufficientEvidence).toBe(true);
    expect(compliantRes.grounded).toBe(true);

    // Non-compliant hallucinated answer
    const hallucinatedAnswer = "Redis cluster is configured with 3 master nodes and Sentinel.";
    const hallucinatedRes = evaluateAnswerQuality(hallucinatedAnswer, [], noEvidenceCase);
    expect(hallucinatedRes.handledInsufficientEvidence).toBe(false);
    expect(hallucinatedRes.grounded).toBe(false);
  });

  it("computes overall evaluation summary with separated metrics", () => {
    const retrievalMap = new Map<string, RetrievedChunk[]>([
      [sampleCase.id, [mockChunk()]],
    ]);
    const answerMap = new Map<string, string>([
      [sampleCase.id, "The system uses DOMPurify and SVG sanitization as defined in [1]."],
    ]);

    const summary = evaluateE2ERag([sampleCase], retrievalMap, answerMap);
    expect(summary.retrievalMetrics.hitAt1).toBe(1.0);
    expect(summary.retrievalMetrics.mrr).toBe(1.0);
    expect(summary.answerMetrics.groundednessRate).toBe(1.0);
    expect(summary.answerMetrics.factualCorrectnessRate).toBe(1.0);
    expect(summary.answerMetrics.citationCorrectnessRate).toBe(1.0);

    const report = formatE2EReport(summary);
    expect(report).toContain("RETRIEVAL EVALUATION");
    expect(report).toContain("ANSWER QUALITY EVALUATION");
    expect(report).toContain("Hit@1");
  });

  it("dataset contains at least 20 valid queries covering required evidence types", () => {
    expect(E2E_RAG_EVAL_DATASET.length).toBeGreaterThanOrEqual(20);

    const hasNoEvidence = E2E_RAG_EVAL_DATASET.some((c) => c.evidenceType === "no_evidence");
    const hasFullEvidence = E2E_RAG_EVAL_DATASET.some((c) => c.evidenceType === "full_evidence");
    const hasMultiChunk = E2E_RAG_EVAL_DATASET.some((c) => c.evidenceType === "multi_chunk");
    const hasAmbiguous = E2E_RAG_EVAL_DATASET.some((c) => c.evidenceType === "ambiguous_symbols");

    expect(hasNoEvidence).toBe(true);
    expect(hasFullEvidence).toBe(true);
    expect(hasMultiChunk).toBe(true);
    expect(hasAmbiguous).toBe(true);
  });

  it("calculates multi-file reasoning rate for cases spanning multiple files", () => {
    const multiFileCase: E2EEvalCase = {
      id: "multi-file-test",
      query: "How do lease claiming and embed workflow interact?",
      category: "cross_file_reasoning",
      evidenceType: "multi_chunk",
      expectedFiles: ["src/lib/leases/repositoryLeases.ts", "src/workflows/embed.ts"],
      expectedConcepts: ["claimEmbeddingLease", "embedRepository"],
      requiredFacts: ["claimEmbeddingLease"],
      forbiddenClaims: ["redis"],
      description: "Multi file test",
    };

    const chunkA = mockChunk({
      filePath: "src/lib/leases/repositoryLeases.ts",
      text: "export function claimEmbeddingLease() {}",
    });
    const chunkB = mockChunk({
      filePath: "src/workflows/embed.ts",
      text: "export function embedRepository() {}",
    });

    const retrievalMap = new Map<string, RetrievedChunk[]>([
      [multiFileCase.id, [chunkA, chunkB]],
    ]);
    const answerMap = new Map<string, string>([
      [multiFileCase.id, "The lease is claimed by claimEmbeddingLease in [1] and run by embedRepository in [2]."],
    ]);

    const summary = evaluateE2ERag([multiFileCase], retrievalMap, answerMap);
    expect(summary.answerMetrics.multiFileTotalCount).toBe(1);
    expect(summary.answerMetrics.multiFileHandledCount).toBe(1);
    expect(summary.answerMetrics.multiFileReasoningRate).toBe(1.0);
  });

  it("does not credit multi-file reasoning when only one expected file is cited", () => {
    const multiFileCase: E2EEvalCase = {
      id: "multi-file-single-citation",
      query: "How do lease claiming and embed workflow interact?",
      category: "cross_file_reasoning",
      evidenceType: "multi_chunk",
      expectedFiles: ["src/lib/leases/repositoryLeases.ts", "src/workflows/embed.ts"],
      expectedConcepts: ["claimEmbeddingLease", "embedRepository"],
      requiredFacts: ["claimEmbeddingLease", "embedRepository"],
      forbiddenClaims: ["redis"],
      description: "Only one of two expected files supported the answer",
    };

    const chunkA = mockChunk({
      id: "chunk-a",
      filePath: "src/lib/leases/repositoryLeases.ts",
      symbolName: "claimEmbeddingLease",
      text: "export function claimEmbeddingLease() {}",
    });
    // The second expected file was retrieved and cited, but it is off by a letter so it matches
    // nothing: `verifyCitations` treats it as unsupported and drops it.
    const chunkB = mockChunk({
      id: "chunk-b",
      filePath: "src/workflows/embedTypo.ts",
      symbolName: "embedRepository",
      text: "export function embedRepository() {}",
    });

    const retrievalMap = new Map<string, RetrievedChunk[]>([
      [multiFileCase.id, [chunkA, chunkB]],
    ]);
    const answerMap = new Map<string, string>([
      [multiFileCase.id, "The lease is claimed by claimEmbeddingLease in [1] and run by embedRepository in [2]."],
    ]);

    const summary = evaluateE2ERag([multiFileCase], retrievalMap, answerMap);
    expect(summary.answerMetrics.multiFileTotalCount).toBe(1);
    // The old `|| chunks.some(...)` fallback matched this on a single expected file.
    expect(summary.answerMetrics.multiFileHandledCount).toBe(0);
    expect(summary.answerMetrics.multiFileReasoningRate).toBe(0.0);
  });

  it("does not credit multi-file reasoning when a second expected file was never retrieved", () => {
    const multiFileCase: E2EEvalCase = {
      id: "multi-file-one-retrieved",
      query: "How do lease claiming and embed workflow interact?",
      category: "cross_file_reasoning",
      evidenceType: "multi_chunk",
      expectedFiles: ["src/lib/leases/repositoryLeases.ts", "src/workflows/embed.ts"],
      expectedConcepts: ["claimEmbeddingLease", "embedRepository"],
      requiredFacts: ["claimEmbeddingLease"],
      forbiddenClaims: ["redis"],
      description: "Second expected file absent from retrieval",
    };

    const chunkA = mockChunk({
      id: "chunk-a",
      filePath: "src/lib/leases/repositoryLeases.ts",
      symbolName: "claimEmbeddingLease",
      text: "export function claimEmbeddingLease() {}",
    });

    const retrievalMap = new Map<string, RetrievedChunk[]>([[multiFileCase.id, [chunkA]]]);
    const answerMap = new Map<string, string>([
      [multiFileCase.id, "The lease is claimed by claimEmbeddingLease in [1]."],
    ]);

    const summary = evaluateE2ERag([multiFileCase], retrievalMap, answerMap);
    expect(summary.answerMetrics.multiFileTotalCount).toBe(1);
    expect(summary.answerMetrics.multiFileHandledCount).toBe(0);
  });
});

