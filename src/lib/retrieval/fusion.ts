/**
 * Ranking and fusion, with no database import, so the offline benchmark exercises the same code
 * production serves instead of a copy that can drift.
 */

export interface FuseCandidate {
  id: string;
  symbolName?: string | null;
  similarity?: number;
}

/**
 * Fuses vector and lexical candidate lists using Reciprocal Rank Fusion (RRF).
 * Adds a relevance boost when a candidate matches the query's exact symbol name.
 *
 * Both the production retriever and the offline retrieval benchmark call this.
 */
export function fuseHybridResults<T extends FuseCandidate>(
  vectorResults: T[],
  lexicalResults: T[],
  topK = 5,
  options?: { k?: number; queryText?: string },
): T[] {
  const k = options?.k ?? 60;
  const queryClean = options?.queryText ? options.queryText.trim().toLowerCase() : "";
  const scoreMap = new Map<string, { chunk: T; score: number }>();

  // Add vector ranks
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const chunk = vectorResults[rank];
    const rrfScore = 1.0 / (k + rank + 1);
    scoreMap.set(chunk.id, { chunk, score: rrfScore });
  }

  // Add lexical ranks
  for (let rank = 0; rank < lexicalResults.length; rank++) {
    const chunk = lexicalResults[rank];
    let rrfScore = 1.0 / (k + rank + 1);

    // Exact symbol boost
    if (queryClean && chunk.symbolName && chunk.symbolName.toLowerCase() === queryClean) {
      rrfScore += 0.05;
    }

    const existing = scoreMap.get(chunk.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(chunk.id, { chunk, score: rrfScore });
    }
  }

  const sorted = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => ({
      ...item.chunk,
      similarity: item.score,
    }));

  return sorted;
}
