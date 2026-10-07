import { RETRIEVAL_EVAL_DATASET } from "./dataset";
import { evaluateRetrieval, formatEvalReport, type EvalMetrics } from "./evaluator";
import { buildBenchmarkCorpus, computeDeterministicEmbedding, type BenchmarkChunk } from "./benchmarkCorpus";
import { fuseHybridResults } from "../fusion";
import type { RetrievedChunk } from "../retriever";

export interface RegressionThresholds {
  minHitAt1: number;
  minHitAt3: number;
  minHitAt5: number;
  minMrr: number;
}

export const DEFAULT_RETRIEVAL_THRESHOLDS: RegressionThresholds = {
  minHitAt1: 0.55,
  minHitAt3: 0.65,
  minHitAt5: 0.75,
  minMrr: 0.60,
};

/**
 * Cosine similarity between two unit vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Pure vector-only retrieval against benchmark corpus.
 */
export function searchVectorBaseline(
  corpus: BenchmarkChunk[],
  queryText: string,
  topK = 5,
): RetrievedChunk[] {
  const queryVec = computeDeterministicEmbedding(queryText);
  const scored = corpus.map((chunk) => ({
    ...chunk,
    similarity: cosineSimilarity(queryVec, chunk.embeddingVector),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

/**
 * Lexical tier weights, mirroring the `CASE` expression in `retrieveChunksLexical`.
 *
 * Production picks exactly one tier per chunk; the previous benchmark added path and per-term text
 * scores on top of the symbol score, so it ranked differently from what production serves and
 * could not detect a regression in the real query.
 */
export const LEXICAL_TIER = {
  exactSymbol: 10.0,
  symbolTerm: 6.0,
  symbolPartial: 3.0,
  path: 2.0,
  text: 1.0,
} as const;

/**
 * Pure lexical retrieval against benchmark corpus.
 * Returns the same single-tier score production SQL assigns.
 */
export function searchLexicalBaseline(
  corpus: BenchmarkChunk[],
  queryText: string,
  topK = 5,
): RetrievedChunk[] {
  const rawTerms = queryText
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const stopWords = new Set(["what", "where", "how", "the", "and", "for", "with", "does", "when", "during"]);
  const terms = rawTerms.filter((t) => !stopWords.has(t));
  const queryClean = queryText.trim().toLowerCase();

  const scored: Array<{ chunk: BenchmarkChunk; score: number }> = [];

  for (const chunk of corpus) {
    const lowerSymbol = (chunk.symbolName || "").toLowerCase();
    const lowerPath = chunk.filePath.toLowerCase();
    const lowerText = chunk.text.toLowerCase();

    // Same order and exclusivity as the SQL CASE: first matching tier wins, no accumulation.
    let score = 0;
    if (lowerSymbol && lowerSymbol === queryClean) {
      score = LEXICAL_TIER.exactSymbol;
    } else if (lowerSymbol && terms.includes(lowerSymbol)) {
      score = LEXICAL_TIER.symbolTerm;
    } else if (lowerSymbol && terms.some((t) => lowerSymbol.includes(t))) {
      score = LEXICAL_TIER.symbolPartial;
    } else if (terms.some((t) => lowerPath.includes(t))) {
      score = LEXICAL_TIER.path;
    } else if (terms.some((t) => lowerText.includes(t))) {
      score = LEXICAL_TIER.text;
    }

    if (score > 0) {
      scored.push({ chunk, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => ({
    ...s.chunk,
    similarity: s.score,
  }));
}

/**
 * Hybrid retrieval combining vector and lexical search via Reciprocal Rank Fusion.
 *
 * Fuses with the production `fuseHybridResults` rather than a copy of it. A duplicated fusion could
 * drift from production, so a change that worsened real search could still leave this benchmark's
 * score unchanged in CI.
 */
export function searchHybridBenchmark(
  corpus: BenchmarkChunk[],
  queryText: string,
  topK = 5,
): RetrievedChunk[] {
  const vectorResults = searchVectorBaseline(corpus, queryText, 15);
  const lexicalResults = searchLexicalBaseline(corpus, queryText, 15);

  return fuseHybridResults(vectorResults, lexicalResults, topK, { queryText });
}

export function checkRegressionThresholds(
  metrics: EvalMetrics,
  thresholds: RegressionThresholds = DEFAULT_RETRIEVAL_THRESHOLDS,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (metrics.hitAt1 < thresholds.minHitAt1) {
    failures.push(`Hit@1 ${(metrics.hitAt1 * 100).toFixed(1)}% is below threshold ${(thresholds.minHitAt1 * 100).toFixed(1)}%`);
  }
  if (metrics.hitAt3 < thresholds.minHitAt3) {
    failures.push(`Hit@3 ${(metrics.hitAt3 * 100).toFixed(1)}% is below threshold ${(thresholds.minHitAt3 * 100).toFixed(1)}%`);
  }
  if (metrics.hitAt5 < thresholds.minHitAt5) {
    failures.push(`Hit@5 ${(metrics.hitAt5 * 100).toFixed(1)}% is below threshold ${(thresholds.minHitAt5 * 100).toFixed(1)}%`);
  }
  if (metrics.mrr < thresholds.minMrr) {
    failures.push(`MRR ${metrics.mrr.toFixed(4)} is below threshold ${thresholds.minMrr.toFixed(4)}`);
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

export function runBenchmark(options?: { checkThresholds?: boolean }) {
  const corpus = buildBenchmarkCorpus();
  console.log(`Loaded benchmark corpus: ${corpus.length} chunks from DRAG repository.`);

  // 1. Run Baseline (Vector-Only)
  const baselineResults = new Map<string, RetrievedChunk[]>();
  for (const q of RETRIEVAL_EVAL_DATASET) {
    baselineResults.set(q.id, searchVectorBaseline(corpus, q.query, 5));
  }
  const baselineMetrics = evaluateRetrieval(RETRIEVAL_EVAL_DATASET, baselineResults);

  // 2. Run Hybrid (Vector + Lexical RRF)
  const hybridResults = new Map<string, RetrievedChunk[]>();
  for (const q of RETRIEVAL_EVAL_DATASET) {
    hybridResults.set(q.id, searchHybridBenchmark(corpus, q.query, 5));
  }
  const hybridMetrics = evaluateRetrieval(RETRIEVAL_EVAL_DATASET, hybridResults);

  console.log("\n" + formatEvalReport("BASELINE (Vector Similarity)", baselineMetrics));
  console.log("\n" + formatEvalReport("HYBRID (Semantic + Lexical RRF)", hybridMetrics));

  console.log("\n--- Comparison ---");
  const delta = (curr: number, prev: number) => {
    const diff = (curr - prev) * 100;
    const sign = diff >= 0 ? "+" : "";
    return `${sign}${diff.toFixed(1)}%`;
  };
  console.log(`Hit@1:  ${(baselineMetrics.hitAt1 * 100).toFixed(1)}% -> ${(hybridMetrics.hitAt1 * 100).toFixed(1)}% (${delta(hybridMetrics.hitAt1, baselineMetrics.hitAt1)})`);
  console.log(`Hit@3:  ${(baselineMetrics.hitAt3 * 100).toFixed(1)}% -> ${(hybridMetrics.hitAt3 * 100).toFixed(1)}% (${delta(hybridMetrics.hitAt3, baselineMetrics.hitAt3)})`);
  console.log(`Hit@5:  ${(baselineMetrics.hitAt5 * 100).toFixed(1)}% -> ${(hybridMetrics.hitAt5 * 100).toFixed(1)}% (${delta(hybridMetrics.hitAt5, baselineMetrics.hitAt5)})`);
  console.log(`MRR:    ${baselineMetrics.mrr.toFixed(4)} -> ${hybridMetrics.mrr.toFixed(4)} (${(hybridMetrics.mrr - baselineMetrics.mrr >= 0 ? "+" : "")}${(hybridMetrics.mrr - baselineMetrics.mrr).toFixed(4)})`);

  if (options?.checkThresholds || process.argv.includes("--check-thresholds")) {
    const check = checkRegressionThresholds(hybridMetrics);
    if (!check.passed) {
      console.error("\n[Regression Check Failed]");
      for (const fail of check.failures) {
        console.error(`  - ${fail}`);
      }
      process.exitCode = 1;
    } else {
      console.log("\n[Regression Check Passed] All metrics meet or exceed defined thresholds.");
    }
  }

  return { baselineMetrics, hybridMetrics };
}

if (process.argv[1] && process.argv[1].includes("runEval")) {
  runBenchmark();
}
