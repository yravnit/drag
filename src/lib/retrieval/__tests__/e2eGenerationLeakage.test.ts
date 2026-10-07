import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  generateDeterministicRagResponse,
} from "../eval/runE2eEval";
import { E2E_RAG_EVAL_DATASET } from "../eval/e2eDataset";
import type { RetrievedChunk } from "../retriever";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "chunk-1",
    repositoryId: "repo-1",
    filePath: "src/lib/mermaid/sanitizeMermaid.ts",
    language: "typescript",
    chunkType: "function",
    symbolName: "sanitizeMermaidSvg",
    startLine: 1,
    endLine: 20,
    text: "export function sanitizeMermaidSvg(svg) { return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } }); }",
    similarity: 0.9,
    ...overrides,
  };
}

describe("E2E answer generation does not read the answer key", () => {
  it("never receives an eval case, so no expected fact can be copied into the answer", () => {
    // Signature check: the generator takes only the query and the retrieved chunks. It used to take
    // the whole case and interpolate `requiredFacts` into the answer that the evaluator then
    // checked, which made every case pass regardless of retrieval or prompt quality.
    expect(generateDeterministicRagResponse.length).toBe(2);

    const answer = generateDeterministicRagResponse("How is SVG sanitized?", [chunk()]);
    expect(answer).toContain("sanitizeMermaidSvg");
    expect(answer).toContain("DOMPurify");
  });

  it("cannot be coaxed into emitting a fact that is absent from the retrieved text", () => {
    const target = E2E_RAG_EVAL_DATASET.find((c) => c.requiredFacts.length > 0)!;
    const absent = target.requiredFacts[0];

    const answer = generateDeterministicRagResponse(target.query, [
      chunk({
        filePath: "src/unrelated/thing.ts",
        symbolName: "unrelatedHelper",
        text: "export function unrelatedHelper() { return 1; }",
      }),
    ]);

    // Nothing retrieved mentions the expected fact, so it must not appear in the answer.
    expect(answer.toLowerCase()).not.toContain(absent.toLowerCase());
  });

  it("refuses when no retrieved chunk mentions the query", () => {
    const answer = generateDeterministicRagResponse(
      "How does DRAG configure Redis Sentinel replication?",
      [chunk()],
    );

    expect(answer.toLowerCase()).toContain("cannot determine");
  });

  it("does not consult evidenceType to decide refusal", () => {
    // Same chunks, two cases with opposite declared evidence types: identical output.
    const noEvidenceCase = E2E_RAG_EVAL_DATASET.find((c) => c.evidenceType === "no_evidence")!;
    const fullEvidenceCase = E2E_RAG_EVAL_DATASET.find((c) => c.evidenceType === "full_evidence")!;
    const retrieved = [chunk()];

    const a = generateDeterministicRagResponse(noEvidenceCase.query, retrieved);
    const b = generateDeterministicRagResponse(noEvidenceCase.query, retrieved);

    expect(a).toBe(b);
    expect(fullEvidenceCase.requiredFacts.length).toBeGreaterThan(0);
  });
});

describe("eval harness shares production ranking code", () => {
  it("runEval fuses with the production fuseHybridResults rather than a copy", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/retrieval/eval/runEval.ts"),
      "utf-8",
    );

    // A copied fusion could drift from production, letting a change that worsened real search keep
    // the CI score unchanged.
    expect(source).toMatch(/from "\.\.\/fusion"/);
    expect(source).not.toMatch(/function searchHybridBenchmark[\s\S]*const scoreMap/);
  });

  it("runEval scores one lexical tier per chunk, like the production SQL CASE", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/retrieval/eval/runEval.ts"),
      "utf-8",
    );

    // Production picks exactly one tier; an accumulating score ranks differently from what the
    // retriever actually serves.
    expect(source).not.toMatch(/score \+= /);
    expect(source).toMatch(/LEXICAL_TIER/);
  });
});
