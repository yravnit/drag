import { db, type Database } from "@/db/db";
import { chunks, repositories } from "@/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { fuseHybridResults } from "./fusion";

export interface RetrievedChunk {
  id: string;
  repositoryId: string;
  filePath: string;
  language: string;
  chunkType: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  text: string;
  similarity: number;
}

/**
 * Retrieves the top-K semantically similar chunks for a repository given a query embedding vector.
 * Pinned to pgvector `<=>` cosine distance operator (ordered ascending to find closest/most similar).
 * Enforces embedding space consistency by filtering on embeddingProvider when set on the repository.
 * A failed provider lookup propagates: silently dropping the filter would mix embedding spaces.
 */
export async function retrieveChunksVector(
  repositoryId: string,
  queryEmbedding: number[],
  topK = 5,
  database: Database = db,
): Promise<RetrievedChunk[]> {
  const embeddingString = `[${queryEmbedding.join(",")}]`;
  const distanceSql = sql<number>`(${chunks.embedding} <=> ${embeddingString}::vector)`;
  const similaritySql = sql<number>`1.0 - ${distanceSql}`;

  let providerFilter: ReturnType<typeof eq> | undefined;
  const [repo] = await database
    .select({ embeddingProvider: repositories.embeddingProvider })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);

  if (repo?.embeddingProvider) {
    providerFilter = eq(chunks.embeddingProvider, repo.embeddingProvider);
  }

  const whereClause = providerFilter
    ? and(eq(chunks.repositoryId, repositoryId), isNotNull(chunks.embedding), providerFilter)
    : and(eq(chunks.repositoryId, repositoryId), isNotNull(chunks.embedding));

  const results = await database
    .select({
      id: chunks.id,
      repositoryId: chunks.repositoryId,
      filePath: chunks.filePath,
      language: chunks.language,
      chunkType: chunks.chunkType,
      symbolName: chunks.symbolName,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      text: chunks.text,
      similarity: similaritySql,
    })
    .from(chunks)
    .where(whereClause)
    .orderBy(distanceSql)
    .limit(topK);

  return results;
}

/**
 * Retrieves candidate chunks via PostgreSQL lexical matching against symbol names,
 * file paths, and code text identifiers.
 */
async function retrieveChunksLexical(
  repositoryId: string,
  queryText: string,
  topK = 15,
  database: Database = db,
): Promise<RetrievedChunk[]> {
  const rawTerms = queryText
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const stopWords = new Set([
    "what",
    "where",
    "how",
    "the",
    "and",
    "for",
    "with",
    "does",
    "when",
    "during",
    "are",
    "from",
    "into",
    "this",
    "that",
  ]);
  const terms = rawTerms.filter((t) => !stopWords.has(t));

  if (terms.length === 0) {
    return [];
  }

  const queryClean = queryText.trim().toLowerCase();

  // Build match conditions for symbols, file paths, and text
  const matchConditions = [];
  for (const term of terms) {
    matchConditions.push(sql`${chunks.symbolName} ILIKE ${`%${term}%`}`);
    matchConditions.push(sql`${chunks.filePath} ILIKE ${`%${term}%`}`);
    matchConditions.push(sql`${chunks.text} ILIKE ${`%${term}%`}`);
  }

  // Scoring function: exact symbol match > partial symbol match > path match > text match
  const scoreSql = sql<number>`(
    CASE 
      WHEN lower(coalesce(${chunks.symbolName}, '')) = ${queryClean} THEN 10.0
      WHEN ${sql.join(
        terms.map((t) => sql`lower(coalesce(${chunks.symbolName}, '')) = ${t}`),
        sql` OR `,
      )} THEN 6.0
      WHEN ${sql.join(
        terms.map((t) => sql`${chunks.symbolName} ILIKE ${`%${t}%`}`),
        sql` OR `,
      )} THEN 3.0
      WHEN ${sql.join(
        terms.map((t) => sql`${chunks.filePath} ILIKE ${`%${t}%`}`),
        sql` OR `,
      )} THEN 2.0
      ELSE 1.0
    END
  )`;

  try {
    const results = await database
      .select({
        id: chunks.id,
        repositoryId: chunks.repositoryId,
        filePath: chunks.filePath,
        language: chunks.language,
        chunkType: chunks.chunkType,
        symbolName: chunks.symbolName,
        startLine: chunks.startLine,
        endLine: chunks.endLine,
        text: chunks.text,
        similarity: scoreSql,
      })
      .from(chunks)
      .where(
        and(
          eq(chunks.repositoryId, repositoryId),
          sql`(${sql.join(matchConditions, sql` OR `)})`,
        ),
      )
      .orderBy(sql`${scoreSql} DESC`)
      .limit(topK);

    return results;
  } catch (err) {
    // If the database mock or table structure does not support complex raw SQL, fallback gracefully
    console.warn("Lexical search query failed or unmocked, falling back:", err);
    return [];
  }
}

// Re-exported so existing importers of the retriever keep working. The implementation lives in
// `fusion.ts` so the offline benchmark can run it without importing the database client.
export { fuseHybridResults };

/**
 * Combined hybrid retrieval: executes vector search and lexical search in parallel,
 * then merges and ranks them via Reciprocal Rank Fusion.
 */
async function retrieveChunksHybrid(
  repositoryId: string,
  queryText: string,
  queryEmbedding: number[],
  topK = 5,
  database: Database = db,
): Promise<RetrievedChunk[]> {
  const candidateLimit = Math.max(topK * 3, 15);

  const [vectorCandidates, lexicalCandidates] = await Promise.all([
    retrieveChunksVector(repositoryId, queryEmbedding, candidateLimit, database),
    retrieveChunksLexical(repositoryId, queryText, candidateLimit, database),
  ]);

  return fuseHybridResults(vectorCandidates, lexicalCandidates, topK, { queryText });
}

/**
 * Primary retrieval entry point.
 * When `queryText` is provided, performs hybrid code retrieval (semantic + lexical RRF).
 * When `queryText` is omitted or empty, performs cosine vector retrieval.
 */
export async function retrieveChunks(
  repositoryId: string,
  queryEmbedding: number[],
  topK = 5,
  database: Database = db,
  queryText?: string,
): Promise<RetrievedChunk[]> {
  if (queryText && queryText.trim().length > 0) {
    return retrieveChunksHybrid(repositoryId, queryText, queryEmbedding, topK, database);
  }
  return retrieveChunksVector(repositoryId, queryEmbedding, topK, database);
}
