import type { RetrievalEvalQuery } from "./dataset";
import type { RetrievedChunk } from "../retriever";

interface QueryEvalResult {
  queryId: string;
  query: string;
  category: string;
  expectedFiles: string[];
  expectedSymbols?: string[];
  retrieved: Array<{
    filePath: string;
    symbolName: string | null;
    score: number;
  }>;
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt5: boolean;
  reciprocalRank: number;
  firstHitRank: number | null;
}

interface CategoryEvalMetrics {
  category: string;
  totalQueries: number;
  hitAt1Count: number;
  hitAt3Count: number;
  hitAt5Count: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
}

export interface EvalMetrics {
  totalQueries: number;
  hitAt1Count: number;
  hitAt3Count: number;
  hitAt5Count: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
  categoryMetrics: CategoryEvalMetrics[];
  results: QueryEvalResult[];
}

/**
 * Checks if a retrieved chunk matches the expected target files and/or symbols.
 */
export function isRelevant(
  chunk: { filePath: string; symbolName: string | null },
  query: RetrievalEvalQuery,
): boolean {
  const fileMatches = query.expectedFiles.some((ef) =>
    chunk.filePath.endsWith(ef) || ef.endsWith(chunk.filePath),
  );

  if (!fileMatches) {
    return false;
  }

  // If expectedSymbols specified, file match is sufficient unless symbols are provided,
  // in which case matching either the file or the specific symbol is considered relevant.
  if (query.expectedSymbols && query.expectedSymbols.length > 0 && chunk.symbolName) {
    const symbolMatches = query.expectedSymbols.includes(chunk.symbolName);
    return fileMatches && symbolMatches;
  }

  return fileMatches;
}

/**
 * Evaluates retrieval results against a benchmark dataset.
 */
export function evaluateRetrieval(
  queries: RetrievalEvalQuery[],
  retrievalResults: Map<string, RetrievedChunk[]>,
): EvalMetrics {
  const results: QueryEvalResult[] = [];
  let hitAt1Count = 0;
  let hitAt3Count = 0;
  let hitAt5Count = 0;
  let totalReciprocalRank = 0;

  const categoryMap = new Map<
    string,
    {
      total: number;
      h1: number;
      h3: number;
      h5: number;
      mrrSum: number;
    }
  >();

  for (const q of queries) {
    const chunks = retrievalResults.get(q.id) || [];
    let firstHitRank: number | null = null;

    for (let i = 0; i < chunks.length; i++) {
      if (isRelevant(chunks[i], q)) {
        firstHitRank = i + 1;
        break;
      }
    }

    const hitAt1 = firstHitRank === 1;
    const hitAt3 = firstHitRank !== null && firstHitRank <= 3;
    const hitAt5 = firstHitRank !== null && firstHitRank <= 5;
    const reciprocalRank = firstHitRank !== null ? 1 / firstHitRank : 0;

    if (hitAt1) hitAt1Count++;
    if (hitAt3) hitAt3Count++;
    if (hitAt5) hitAt5Count++;
    totalReciprocalRank += reciprocalRank;

    // Category aggregation
    const cat = q.category;
    const currentCat = categoryMap.get(cat) || {
      total: 0,
      h1: 0,
      h3: 0,
      h5: 0,
      mrrSum: 0,
    };
    currentCat.total++;
    if (hitAt1) currentCat.h1++;
    if (hitAt3) currentCat.h3++;
    if (hitAt5) currentCat.h5++;
    currentCat.mrrSum += reciprocalRank;
    categoryMap.set(cat, currentCat);

    results.push({
      queryId: q.id,
      query: q.query,
      category: q.category,
      expectedFiles: q.expectedFiles,
      expectedSymbols: q.expectedSymbols,
      retrieved: chunks.map((c) => ({
        filePath: c.filePath,
        symbolName: c.symbolName,
        score: c.similarity,
      })),
      hitAt1,
      hitAt3,
      hitAt5,
      reciprocalRank,
      firstHitRank,
    });
  }

  const n = queries.length;

  const categoryMetrics: CategoryEvalMetrics[] = Array.from(categoryMap.entries()).map(
    ([category, data]) => ({
      category,
      totalQueries: data.total,
      hitAt1Count: data.h1,
      hitAt3Count: data.h3,
      hitAt5Count: data.h5,
      hitAt1: data.total > 0 ? data.h1 / data.total : 0,
      hitAt3: data.total > 0 ? data.h3 / data.total : 0,
      hitAt5: data.total > 0 ? data.h5 / data.total : 0,
      mrr: data.total > 0 ? data.mrrSum / data.total : 0,
    }),
  );

  return {
    totalQueries: n,
    hitAt1Count,
    hitAt3Count,
    hitAt5Count,
    hitAt1: n > 0 ? hitAt1Count / n : 0,
    hitAt3: n > 0 ? hitAt3Count / n : 0,
    hitAt5: n > 0 ? hitAt5Count / n : 0,
    mrr: n > 0 ? totalReciprocalRank / n : 0,
    categoryMetrics,
    results,
  };
}

/**
 * Formats a terminal summary report of evaluation metrics.
 */
export function formatEvalReport(title: string, metrics: EvalMetrics): string {
  const pct = (val: number) => (val * 100).toFixed(1) + "%";
  const lines: string[] = [
    `============================================================`,
    ` ${title}`,
    ` Total queries: ${metrics.totalQueries}`,
    `------------------------------------------------------------`,
    ` Metric      | Count | Percentage`,
    `-------------|-------|-----------`,
    ` Hit@1       | ${String(metrics.hitAt1Count).padStart(5)} | ${pct(metrics.hitAt1).padStart(9)}`,
    ` Hit@3       | ${String(metrics.hitAt3Count).padStart(5)} | ${pct(metrics.hitAt3).padStart(9)}`,
    ` Hit@5       | ${String(metrics.hitAt5Count).padStart(5)} | ${pct(metrics.hitAt5).padStart(9)}`,
    ` MRR         |       | ${metrics.mrr.toFixed(4).padStart(9)}`,
    `============================================================`,
  ];

  if (metrics.categoryMetrics && metrics.categoryMetrics.length > 0) {
    lines.push(`\n--- Category Breakdown ---`);
    lines.push(
      ` Category                 | Queries |  Hit@1 |  Hit@3 |  Hit@5 |    MRR`,
    );
    lines.push(
      `--------------------------|---------|--------|--------|--------|-------`,
    );
    for (const cm of metrics.categoryMetrics) {
      lines.push(
        ` ${cm.category.padEnd(24)} | ${String(cm.totalQueries).padStart(7)} | ${pct(cm.hitAt1).padStart(6)} | ${pct(cm.hitAt3).padStart(6)} | ${pct(cm.hitAt5).padStart(6)} | ${cm.mrr.toFixed(4).padStart(6)}`,
      );
    }
  }

  return lines.join("\n");
}
