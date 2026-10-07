import { Database } from "@/db/db";
import {
  repositories,
  chunks,
  repositoryFiles,
  NewChunk,
  NewRepositoryFile,
  Repository,
} from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { RepositoryMetadata } from "./repositoryProvider";
import { ProcessedFileResult } from "./batchProcessor";
import { RawChunk } from "./semanticChunker";
import fs from "fs";

async function getChunksList(res: ProcessedFileResult): Promise<RawChunk[]> {
  if (res.chunks && res.chunks.length > 0) {
    return res.chunks;
  }
  const tempPath = res.tempChunksPath;
  if (tempPath && fs.existsSync(tempPath)) {
    const data = await fs.promises.readFile(tempPath, "utf-8");
    return JSON.parse(data) as RawChunk[];
  }
  return [];
}

export interface DatabaseLayerOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Determines whether a database error is transient (safe to retry).
 * Transient errors include network disconnects, timeouts, deadlocks, serialization failures, and 5xx/429 status codes.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  const code = String(err.code || "");
  const message = String(err.message || "").toLowerCase();

  const transientPostgresCodes = new Set([
    "40001",
    "40P01",
    "57014",
    "57P01",
    "08000",
    "08001",
    "08003",
    "08004",
    "08006",
    "08007",
  ]);
  if (transientPostgresCodes.has(code)) return true;

  const transientKeywords = [
    "econnreset",
    "etimedout",
    "epipe",
    "enotfound",
    "econnrefused",
    "connection closed",
    "connection reset",
    "timeout",
    "network error",
  ];
  // Numeric HTTP status codes matched as whole words to avoid false substring matches
  const transientStatusCodes = [502, 503, 504, 429];

  if (transientKeywords.some((kw) => message.includes(kw))) return true;
  if (transientStatusCodes.some((code) => new RegExp(`\\b${code}\\b`).test(message))) return true;
  return false;
}

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Persists chunks and file tracking records for processed files within an active transaction.
 * Uses bounded batching (150 rows per insert) with ON CONFLICT DO NOTHING.
 */
export async function persistProcessedFilesChunks(
  tx: DatabaseTransaction,
  repositoryId: string,
  processedFiles: ProcessedFileResult[],
  now: Date = new Date(),
): Promise<{ totalChunksInserted: number }> {
  let totalInserted = 0;
  let chunkBatch: NewChunk[] = [];
  let fileBatch: NewRepositoryFile[] = [];
  const BATCH_LIMIT = 150;

  for (const res of processedFiles) {
    if (res.error) continue;

    if (res.contentHash) {
      fileBatch.push({
        repositoryId,
        filePath: res.file.relativePath,
        contentHash: res.contentHash,
        sizeBytes: String(res.sizeBytes || 0),
        indexedAt: now,
      });
    }

    const fileChunks = await getChunksList(res);
    for (const rawChunk of fileChunks) {
      chunkBatch.push({
        repositoryId,
        filePath: res.file.relativePath,
        language: rawChunk.language,
        chunkType: rawChunk.chunkType,
        symbolName: rawChunk.symbolName,
        startLine: rawChunk.startLine,
        endLine: rawChunk.endLine,
        text: rawChunk.text,
        embedding: null,
      });
      totalInserted++;

      if (chunkBatch.length >= BATCH_LIMIT) {
        await tx.insert(chunks).values(chunkBatch).onConflictDoNothing();
        chunkBatch = [];
      }
    }

    if (fileBatch.length >= BATCH_LIMIT) {
      await tx.insert(repositoryFiles).values(fileBatch).onConflictDoNothing();
      fileBatch = [];
    }
  }

  // Flush remaining
  if (chunkBatch.length > 0) {
    await tx.insert(chunks).values(chunkBatch).onConflictDoNothing();
  }
  if (fileBatch.length > 0) {
    await tx.insert(repositoryFiles).values(fileBatch).onConflictDoNothing();
  }

  return { totalChunksInserted: totalInserted };
}

export class IngestionDatabaseLayer {
  private database: Database;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(database: Database, options?: DatabaseLayerOptions) {
    this.database = database;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
  }

  /**
   * Retries an async database action with exponential backoff ONLY on transient failures.
   */
  private async withRetry<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        attempt++;
        const isTransient = isTransientDatabaseError(error);
        if (!isTransient || attempt > this.maxRetries) {
          let message = "Unknown error";
          if (error instanceof Error) {
            message = error.message;
          } else if (error && typeof error === "object" && "message" in error) {
            message = String(error.message);
          } else if (error !== null && error !== undefined) {
            message = String(error);
          }
          throw new Error(
            `[Database Error] Operation '${operationName}' failed (${isTransient ? "max retries reached" : "non-transient error"}): ${message}`,
            { cause: error },
          );
        }
        const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Database Warning] Transient retry attempt ${attempt}/${this.maxRetries} for '${operationName}' after ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Retrieves an existing repository record by GitHub numeric repository ID.
   */
  public async getRepositoryByGithubId(
    githubId: bigint | number,
  ): Promise<Repository | null> {
    return this.withRetry("getRepositoryByGithubId", async () => {
      const records = await this.database
        .select()
        .from(repositories)
        .where(eq(repositories.githubId, BigInt(githubId)))
        .limit(1);
      return records.length > 0 ? records[0] : null;
    });
  }

  /**
   * Retrieves an existing repository record by repository URL.
   */
  public async getRepositoryByUrl(url: string): Promise<Repository | null> {
    return this.withRetry("getRepositoryByUrl", async () => {
      const records = await this.database
        .select()
        .from(repositories)
        .where(eq(repositories.url, url))
        .limit(1);
      return records.length > 0 ? records[0] : null;
    });
  }

  /**
   * Updates only the HEAD commit SHA and updatedAt timestamp for a repository.
   * Used when only ignored/non-indexable files changed in a commit to advance HEAD.
   */
  public async updateHeadCommitSha(
    repositoryId: string,
    headCommitSha: string,
  ): Promise<void> {
    return this.withRetry("updateHeadCommitSha", async () => {
      await this.database
        .update(repositories)
        .set({
          headCommitSha,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, repositoryId));
    });
  }

  /**
   * Retrieves an existing repository record by owner and name.
   */
  public async getRepositoryByOwnerAndName(
    owner: string,
    name: string,
  ): Promise<Repository | null> {
    return this.withRetry("getRepositoryByOwnerAndName", async () => {
      const records = await this.database
        .select()
        .from(repositories)
        .where(and(eq(repositories.owner, owner), eq(repositories.name, name)))
        .limit(1);
      return records.length > 0 ? records[0] : null;
    });
  }

  /**
   * Retrieves all tracked files and their content hashes for a repository.
   * Returns a Map of relative file path -> content hash.
   */
  public async getRepositoryFiles(repositoryId: string): Promise<Map<string, string>> {
    return this.withRetry("getRepositoryFiles", async () => {
      const records = await this.database
        .select({ filePath: repositoryFiles.filePath, contentHash: repositoryFiles.contentHash })
        .from(repositoryFiles)
        .where(eq(repositoryFiles.repositoryId, repositoryId));

      const fileMap = new Map<string, string>();
      for (const rec of records) {
        fileMap.set(rec.filePath, rec.contentHash);
      }
      return fileMap;
    });
  }

  /**
   * Upserts repository metadata using a single PostgreSQL INSERT ... ON CONFLICT DO UPDATE query.
   * Uses githubId as primary conflict target when available, falling back to url.
   * Single database round-trip, race-condition safe.
   */
  public async upsertRepository(metadata: RepositoryMetadata): Promise<string> {
    return this.withRetry("upsertRepository", async () => {
      const now = new Date();
      const githubId = metadata.githubId ? BigInt(metadata.githubId) : null;
      const isPrivate = Boolean(metadata.isPrivate);
      const defaultProvider = isPrivate ? "cloudflare" : "gemini";
      const defaultModel = isPrivate ? "@cf/qwen/qwen3-embedding-0.6b" : "gemini-embedding-2";

      if (githubId) {
        const [inserted] = await this.database
          .insert(repositories)
          .values({
            githubId,
            name: metadata.name,
            owner: metadata.owner,
            url: metadata.url,
            defaultBranch: metadata.defaultBranch,
            description: metadata.description,
            primaryLanguage: metadata.primaryLanguage,
            headCommitSha: metadata.headCommitSha,
            isPrivate,
            embeddingProvider: metadata.embeddingProvider ?? defaultProvider,
            embeddingModel: metadata.embeddingModel ?? defaultModel,
            embeddingDimensions: metadata.embeddingDimensions ?? 768,
            indexedAt: now,
          })
          .onConflictDoUpdate({
            target: repositories.githubId,
            // ponytail: `isPrivate` is updated here but `embeddingProvider` is not, so chunks
            // indexed as Gemini survive a public -> private flip. The leak is closed in
            // router.ts (private always resolves to Cloudflare). Ceiling: stale chunks in the
            // wrong space. Upgrade path: clear chunks + embedding fields when visibility flips.
            set: {
              name: metadata.name,
              owner: metadata.owner,
              url: metadata.url,
              defaultBranch: metadata.defaultBranch,
              description: metadata.description,
              primaryLanguage: metadata.primaryLanguage,
              headCommitSha: metadata.headCommitSha,
              isPrivate,
              indexedAt: now,
              updatedAt: now,
            },
          })
          .returning({ id: repositories.id });

        return inserted.id;
      }

      const [inserted] = await this.database
        .insert(repositories)
        .values({
          name: metadata.name,
          owner: metadata.owner,
          url: metadata.url,
          defaultBranch: metadata.defaultBranch,
          description: metadata.description,
          primaryLanguage: metadata.primaryLanguage,
          headCommitSha: metadata.headCommitSha,
          isPrivate,
          embeddingProvider: metadata.embeddingProvider ?? defaultProvider,
          embeddingModel: metadata.embeddingModel ?? defaultModel,
          embeddingDimensions: metadata.embeddingDimensions ?? 768,
          indexedAt: now,
        })
        .onConflictDoUpdate({
          target: repositories.url,
          set: {
            name: metadata.name,
            owner: metadata.owner,
            defaultBranch: metadata.defaultBranch,
            description: metadata.description,
            primaryLanguage: metadata.primaryLanguage,
            headCommitSha: metadata.headCommitSha,
            isPrivate,
            indexedAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: repositories.id });

      return inserted.id;
    });
  }

  /**
   * Full replace of all chunks and per-file metadata for a repository inside a transaction.
   */
  public async saveRepositoryChunks(
    repositoryId: string,
    processedFiles: ProcessedFileResult[],
  ): Promise<{ totalChunksInserted: number }> {
    return this.withRetry("saveRepositoryChunks", async () => {
      const now = new Date();
      let totalInserted = 0;

      await this.database.transaction(async (tx) => {
        // Delete previous chunks and file tracking records
        await tx.delete(chunks).where(eq(chunks.repositoryId, repositoryId));
        await tx.delete(repositoryFiles).where(eq(repositoryFiles.repositoryId, repositoryId));

        const result = await persistProcessedFilesChunks(tx, repositoryId, processedFiles, now);
        totalInserted = result.totalChunksInserted;
      });

      return { totalChunksInserted: totalInserted };
    });
  }

  /**
   * Incremental chunk and per-file metadata persistence inside a single transaction.
   * Deletes chunks and repository_files records only for modified/deleted files,
   * inserts new chunks and repository_files records only for changed/new files.
   * Touches no unchanged chunks or file records.
   */
  public async saveIncrementalChunks(
    repositoryId: string,
    processedFiles: ProcessedFileResult[],
    deletedFilePaths: string[],
    metadata: RepositoryMetadata,
  ): Promise<{ totalChunksInserted: number; totalFilesProcessed: number }> {
    return this.withRetry("saveIncrementalChunks", async () => {
      const modifiedOrAddedPaths: string[] = [];
      const now = new Date();
      let totalInserted = 0;
      let totalFiles = 0;

      for (const res of processedFiles) {
        if (res.error) continue;
        modifiedOrAddedPaths.push(res.file.relativePath);
        totalFiles++;
      }

      const allPathsToDelete = Array.from(new Set([...deletedFilePaths, ...modifiedOrAddedPaths]));

      await this.database.transaction(async (tx) => {
        // Delete chunks and per-file records for removed or modified files
        if (allPathsToDelete.length > 0) {
          const DELETE_BATCH_SIZE = 200;
          for (let i = 0; i < allPathsToDelete.length; i += DELETE_BATCH_SIZE) {
            const batch = allPathsToDelete.slice(i, i + DELETE_BATCH_SIZE);
            await tx
              .delete(chunks)
              .where(and(eq(chunks.repositoryId, repositoryId), inArray(chunks.filePath, batch)));
            await tx
              .delete(repositoryFiles)
              .where(
                and(
                  eq(repositoryFiles.repositoryId, repositoryId),
                  inArray(repositoryFiles.filePath, batch),
                ),
              );
          }
        }

        const result = await persistProcessedFilesChunks(tx, repositoryId, processedFiles, now);
        totalInserted = result.totalChunksInserted;

        // Update repository metadata within the same transaction.
        // `isPrivate` is written unconditionally: a repo that flips public -> private without being
        // renamed keeps its stale value otherwise, and `runEmbedBatch` reads that value to pick
        // between Gemini and Cloudflare. This is the incremental twin of `upsertRepository`, which
        // does the same on the full path.
        await tx
          .update(repositories)
          .set({
            headCommitSha: metadata.headCommitSha,
            isPrivate: Boolean(metadata.isPrivate),
            indexedAt: now,
            updatedAt: now,
          })
          .where(eq(repositories.id, repositoryId));
      });

      return {
        totalChunksInserted: totalInserted,
        totalFilesProcessed: totalFiles,
      };
    });
  }
}
