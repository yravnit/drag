import type { E2EEvalCase } from "./e2eDataset";
import type { RetrievedChunk } from "../retriever";

interface E2ERetrievalMetrics {
  totalQueries: number;
  hitAt1Count: number;
  hitAt3Count: number;
  hitAt5Count: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
}

interface E2EAnswerMetrics {
  totalEvaluated: number;
  groundedCount: number;
  groundednessRate: number;
  factuallyCorrectCount: number;
  factualCorrectnessRate: number;
  citationCorrectCount: number;
  citationCorrectnessRate: number;
  insufficientEvidenceHandledCount: number;
  insufficientEvidenceTotalCount: number;
  insufficientEvidenceHandlingRate: number;
  multiFileTotalCount: number;
  multiFileHandledCount: number;
  multiFileReasoningRate: number;
}

interface E2ECaseResult {
  caseId: string;
  query: string;
  evidenceType: string;
  retrievalHitAt1: boolean;
  retrievalHitAt3: boolean;
  retrievalHitAt5: boolean;
  firstHitRank: number | null;
  answerText: string;
  citationsParsed: number[];
  citationCorrect: boolean;
  grounded: boolean;
  factuallyCorrect: boolean;
  handledInsufficientEvidence: boolean;
  failureReasons: string[];
}

export interface E2EEvalSummary {
  retrievalMetrics: E2ERetrievalMetrics;
  answerMetrics: E2EAnswerMetrics;
  caseResults: E2ECaseResult[];
}

/**
 * Checks whether a retrieved chunk matches the expected files/symbols for an E2E case.
 */
export function isE2EChunkRelevant(chunk: RetrievedChunk, evalCase: E2EEvalCase): boolean {
  if (evalCase.expectedFiles.length === 0) {
    // If no expected files (e.g. no_evidence case), nothing is relevant
    return false;
  }

  const fileMatches = evalCase.expectedFiles.some((ef) =>
    chunk.filePath.endsWith(ef) || ef.endsWith(chunk.filePath),
  );

  if (!fileMatches) {
    return false;
  }

  if (evalCase.expectedSymbols && evalCase.expectedSymbols.length > 0 && chunk.symbolName) {
    return evalCase.expectedSymbols.includes(chunk.symbolName);
  }

  return fileMatches;
}

/**
 * Parses bracket citation numbers like [1], [2] from text.
 */
export function extractCitations(text: string): number[] {
  const matches = text.matchAll(/\[(\d+)\]/g);
  const indices: number[] = [];
  for (const m of matches) {
    const idx = parseInt(m[1], 10);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices;
}

/**
 * Checks whether citations genuinely support the claims made.
 */
export function verifyCitations(
  citationsParsed: number[],
  retrievedChunks: RetrievedChunk[],
  evalCase: E2EEvalCase,
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (evalCase.evidenceType === "no_evidence") {
    // In no_evidence cases, citations are not expected since no evidence exists
    return { valid: true, reasons: [] };
  }

  if (citationsParsed.length === 0) {
    // If evidence exists but model cited nothing
    reasons.push("No citations provided for evidence-supported claim");
    return { valid: false, reasons };
  }

  for (const idx of citationsParsed) {
    const chunkIndex = idx - 1;
    if (chunkIndex < 0 || chunkIndex >= retrievedChunks.length) {
      reasons.push(`Citation [${idx}] is out of bounds (retrieved: ${retrievedChunks.length})`);
      continue;
    }

    const chunk = retrievedChunks[chunkIndex];
    // Check if the cited chunk is from expected files or contains expected symbols/concepts
    const fileMatches = evalCase.expectedFiles.some(
      (ef) => chunk.filePath.endsWith(ef) || ef.endsWith(chunk.filePath),
    );
    const conceptMatches = evalCase.expectedConcepts.some((c) =>
      chunk.text.toLowerCase().includes(c.toLowerCase()),
    );

    if (!fileMatches && !conceptMatches) {
      reasons.push(`Citation [${idx}] points to unrelated file: ${chunk.filePath}`);
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

/**
 * Evaluates generated answer against test case requirements.
 */
export function evaluateAnswerQuality(
  answerText: string,
  retrievedChunks: RetrievedChunk[],
  evalCase: E2EEvalCase,
): {
  grounded: boolean;
  factuallyCorrect: boolean;
  citationCorrect: boolean;
  handledInsufficientEvidence: boolean;
  citationsParsed: number[];
  failureReasons: string[];
} {
  const lowerAnswer = answerText.toLowerCase();
  const failureReasons: string[] = [];
  const citationsParsed = extractCitations(answerText);

  // 1. Forbidden Claims Check
  for (const forbidden of evalCase.forbiddenClaims) {
    if (lowerAnswer.includes(forbidden.toLowerCase())) {
      failureReasons.push(`Answer contains forbidden claim: "${forbidden}"`);
    }
  }

  // 2. Insufficient Evidence / Groundedness Handling
  const indicatesCannotDetermine =
    lowerAnswer.includes("cannot determine") ||
    lowerAnswer.includes("not enough evidence") ||
    lowerAnswer.includes("not specified in") ||
    lowerAnswer.includes("does not contain evidence");

  let handledInsufficientEvidence = true;
  let grounded = true;

  if (evalCase.evidenceType === "no_evidence") {
    if (!indicatesCannotDetermine) {
      failureReasons.push("Model failed to state insufficient evidence for query lacking repository evidence");
      handledInsufficientEvidence = false;
      grounded = false;
    }
  } else if (evalCase.evidenceType === "partial_evidence") {
    // Should answer what is known but note missing details
    if (failureReasons.length > 0) {
      grounded = false;
    }
  } else {
    // Full evidence or multi-chunk: verify required facts
    let missingFactsCount = 0;
    for (const fact of evalCase.requiredFacts) {
      if (!lowerAnswer.includes(fact.toLowerCase())) {
        missingFactsCount++;
        failureReasons.push(`Missing required fact: "${fact}"`);
      }
    }
    if (missingFactsCount > 0) {
      grounded = false;
    }
  }

  // 3. Citation Correctness Check
  const citationCheck = verifyCitations(citationsParsed, retrievedChunks, evalCase);
  if (!citationCheck.valid) {
    failureReasons.push(...citationCheck.reasons);
  }

  const factuallyCorrect = failureReasons.filter((r) => !r.includes("Citation")).length === 0;

  return {
    grounded: grounded && failureReasons.length === 0,
    factuallyCorrect,
    citationCorrect: citationCheck.valid,
    handledInsufficientEvidence,
    citationsParsed,
    failureReasons,
  };
}

/**
 * Runs complete End-to-End RAG evaluation on a collection of cases.
 */
export function evaluateE2ERag(
  cases: E2EEvalCase[],
  retrievalMap: Map<string, RetrievedChunk[]>,
  answerMap: Map<string, string>,
): E2EEvalSummary {
  let hitAt1Count = 0;
  let hitAt3Count = 0;
  let hitAt5Count = 0;
  let totalReciprocalRank = 0;
  let retrievalEligibleCount = 0;

  let groundedCount = 0;
  let factuallyCorrectCount = 0;
  let citationCorrectCount = 0;
  let insufficientEvidenceHandledCount = 0;
  let insufficientEvidenceTotalCount = 0;
  let multiFileTotalCount = 0;
  let multiFileHandledCount = 0;

  const caseResults: E2ECaseResult[] = [];

  for (const c of cases) {
    const chunks = retrievalMap.get(c.id) || [];
    const answer = answerMap.get(c.id) || "";

    // Retrieval evaluation
    let firstHitRank: number | null = null;
    const isRetrievalCase = c.expectedFiles.length > 0;

    if (isRetrievalCase) {
      retrievalEligibleCount++;
      for (let i = 0; i < chunks.length; i++) {
        if (isE2EChunkRelevant(chunks[i], c)) {
          firstHitRank = i + 1;
          break;
        }
      }

      if (firstHitRank === 1) hitAt1Count++;
      if (firstHitRank !== null && firstHitRank <= 3) hitAt3Count++;
      if (firstHitRank !== null && firstHitRank <= 5) hitAt5Count++;
      if (firstHitRank !== null) totalReciprocalRank += 1 / firstHitRank;
    }

    // Answer evaluation
    const isInsufficientCase =
      c.evidenceType === "no_evidence" || c.evidenceType === "partial_evidence";
    if (isInsufficientCase) {
      insufficientEvidenceTotalCount++;
    }

    const isMultiFileCase = c.expectedFiles.length > 1;
    if (isMultiFileCase) {
      multiFileTotalCount++;
    }

    const evalRes = evaluateAnswerQuality(answer, chunks, c);

    if (evalRes.grounded) groundedCount++;
    if (evalRes.factuallyCorrect) factuallyCorrectCount++;
    if (evalRes.citationCorrect) citationCorrectCount++;
    if (isInsufficientCase && evalRes.handledInsufficientEvidence) {
      insufficientEvidenceHandledCount++;
    }

    if (isMultiFileCase && evalRes.grounded && evalRes.factuallyCorrect && evalRes.citationCorrect) {
      // Check that cited chunks or retrieved chunks reference more than one expected file
      const citedFiles = new Set<string>();
      for (const idx of evalRes.citationsParsed) {
        const chunk = chunks[idx - 1];
        if (chunk) {
          for (const ef of c.expectedFiles) {
            if (chunk.filePath.endsWith(ef) || ef.endsWith(chunk.filePath)) {
              citedFiles.add(ef);
            }
          }
        }
      }
      if (citedFiles.size > 1 || chunks.some((ch) => c.expectedFiles.some((ef) => ch.filePath.endsWith(ef)))) {
        multiFileHandledCount++;
      }
    }

    caseResults.push({
      caseId: c.id,
      query: c.query,
      evidenceType: c.evidenceType,
      retrievalHitAt1: firstHitRank === 1,
      retrievalHitAt3: firstHitRank !== null && firstHitRank <= 3,
      retrievalHitAt5: firstHitRank !== null && firstHitRank <= 5,
      firstHitRank,
      answerText: answer,
      citationsParsed: evalRes.citationsParsed,
      citationCorrect: evalRes.citationCorrect,
      grounded: evalRes.grounded,
      factuallyCorrect: evalRes.factuallyCorrect,
      handledInsufficientEvidence: evalRes.handledInsufficientEvidence,
      failureReasons: evalRes.failureReasons,
    });
  }

  const n = cases.length;
  const nRet = Math.max(retrievalEligibleCount, 1);

  return {
    retrievalMetrics: {
      totalQueries: retrievalEligibleCount,
      hitAt1Count,
      hitAt3Count,
      hitAt5Count,
      hitAt1: hitAt1Count / nRet,
      hitAt3: hitAt3Count / nRet,
      hitAt5: hitAt5Count / nRet,
      mrr: totalReciprocalRank / nRet,
    },
    answerMetrics: {
      totalEvaluated: n,
      groundedCount,
      groundednessRate: n > 0 ? groundedCount / n : 0,
      factuallyCorrectCount,
      factualCorrectnessRate: n > 0 ? factuallyCorrectCount / n : 0,
      citationCorrectCount,
      citationCorrectnessRate: n > 0 ? citationCorrectCount / n : 0,
      insufficientEvidenceHandledCount,
      insufficientEvidenceTotalCount,
      insufficientEvidenceHandlingRate:
        insufficientEvidenceTotalCount > 0
          ? insufficientEvidenceHandledCount / insufficientEvidenceTotalCount
          : 1.0,
      multiFileTotalCount,
      multiFileHandledCount,
      multiFileReasoningRate:
        multiFileTotalCount > 0 ? multiFileHandledCount / multiFileTotalCount : 1.0,
    },
    caseResults,
  };
}

/**
 * Formats a terminal summary of the End-to-End RAG evaluation.
 */
export function formatE2EReport(summary: E2EEvalSummary): string {
  const pct = (val: number) => (val * 100).toFixed(1) + "%";
  const { retrievalMetrics: rm, answerMetrics: am } = summary;

  const lines: string[] = [
    `============================================================`,
    ` DRAG End-to-End RAG Quality Evaluation`,
    ` Total Cases: ${am.totalEvaluated} (${rm.totalQueries} retrieval cases, ${am.insufficientEvidenceTotalCount} no/partial evidence)`,
    `============================================================`,
    ``,
    `[1] RETRIEVAL EVALUATION (Separate from generation)`,
    `------------------------------------------------------------`,
    ` Metric      | Count | Percentage`,
    `-------------|-------|-----------`,
    ` Hit@1       | ${String(rm.hitAt1Count).padStart(5)} | ${pct(rm.hitAt1).padStart(9)}`,
    ` Hit@3       | ${String(rm.hitAt3Count).padStart(5)} | ${pct(rm.hitAt3).padStart(9)}`,
    ` Hit@5       | ${String(rm.hitAt5Count).padStart(5)} | ${pct(rm.hitAt5).padStart(9)}`,
    ` MRR         |       | ${rm.mrr.toFixed(4).padStart(9)}`,
    ``,
    `[2] ANSWER QUALITY EVALUATION (Groundedness & Correctness)`,
    `------------------------------------------------------------`,
    ` Metric                           | Count | Percentage`,
    `----------------------------------|-------|-----------`,
    ` Answer Groundedness              | ${String(am.groundedCount).padStart(5)} | ${pct(am.groundednessRate).padStart(9)}`,
    ` Factual Correctness              | ${String(am.factuallyCorrectCount).padStart(5)} | ${pct(am.factualCorrectnessRate).padStart(9)}`,
    ` Citation Correctness             | ${String(am.citationCorrectCount).padStart(5)} | ${pct(am.citationCorrectnessRate).padStart(9)}`,
    ` Insufficient Evidence Handling   | ${String(am.insufficientEvidenceHandledCount).padStart(5)} | ${pct(am.insufficientEvidenceHandlingRate).padStart(9)}`,
    ` Multi-File Reasoning             | ${String(am.multiFileHandledCount).padStart(5)} | ${pct(am.multiFileReasoningRate).padStart(9)}`,
    `============================================================`,
  ];

  return lines.join("\n");
}
