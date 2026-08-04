import { db } from "@/db/db";
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

export class IngestionDatabaseLayer {
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(options?: DatabaseLayerOptions) {
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
          throw new Error(
            `[Database Error] Operation '${operationName}' failed (${isTransient ? "max retries reached" : "non-transient error"}): ${(error as Error).message}`,
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
   * Retrieves an existing repository record by repository URL.
   */
  public async getRepositoryByUrl(url: string): Promise<Repository | null> {
    return this.withRetry("getRepositoryByUrl", async () => {
      const records = await db
        .select()
        .from(repositories)
        .where(eq(repositories.url, url))
        .limit(1);
      return records.length > 0 ? records[0] : null;
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
      const records = await db
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
      const records = await db
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
   * Upserts repository metadata using a single PostgreSQL INSERT ... ON CONFLICT(url) DO UPDATE query.
   * Single database round-trip, race-condition safe.
   */
  public async upsertRepository(metadata: RepositoryMetadata): Promise<string> {
    return this.withRetry("upsertRepository", async () => {
      const now = new Date();

      const [inserted] = await db
        .insert(repositories)
        .values({
          name: metadata.name,
          owner: metadata.owner,
          url: metadata.url,
          defaultBranch: metadata.defaultBranch,
          description: metadata.description,
          primaryLanguage: metadata.primaryLanguage,
          headCommitSha: metadata.headCommitSha,
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
      const allNewChunks: NewChunk[] = [];
      const allNewFiles: NewRepositoryFile[] = [];
      const now = new Date();

      for (const res of processedFiles) {
        if (res.error) continue;

        if (res.contentHash) {
          allNewFiles.push({
            repositoryId,
            filePath: res.file.relativePath,
            contentHash: res.contentHash,
            sizeBytes: String(res.sizeBytes || 0),
            indexedAt: now,
          });
        }

        for (const rawChunk of res.chunks) {
          allNewChunks.push({
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
        }
      }

      await db.transaction(async (tx) => {
        // Delete previous chunks and file tracking records
        await tx.delete(chunks).where(eq(chunks.repositoryId, repositoryId));
        await tx.delete(repositoryFiles).where(eq(repositoryFiles.repositoryId, repositoryId));

        // Insert repository_files records in batches
        if (allNewFiles.length > 0) {
          const FILE_BATCH_SIZE = 150;
          for (let i = 0; i < allNewFiles.length; i += FILE_BATCH_SIZE) {
            await tx
              .insert(repositoryFiles)
              .values(allNewFiles.slice(i, i + FILE_BATCH_SIZE))
              .onConflictDoNothing();
          }
        }

        // Insert chunk records in batches
        if (allNewChunks.length > 0) {
          const DB_BATCH_SIZE = 150;
          for (let i = 0; i < allNewChunks.length; i += DB_BATCH_SIZE) {
            await tx
              .insert(chunks)
              .values(allNewChunks.slice(i, i + DB_BATCH_SIZE))
              .onConflictDoNothing();
          }
        }
      });

      return { totalChunksInserted: allNewChunks.length };
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
      const newChunks: NewChunk[] = [];
      const newFiles: NewRepositoryFile[] = [];
      const now = new Date();

      for (const res of processedFiles) {
        if (res.error) continue;
        modifiedOrAddedPaths.push(res.file.relativePath);

        if (res.contentHash) {
          newFiles.push({
            repositoryId,
            filePath: res.file.relativePath,
            contentHash: res.contentHash,
            sizeBytes: String(res.sizeBytes || 0),
            indexedAt: now,
          });
        }

        for (const rawChunk of res.chunks) {
          newChunks.push({
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
        }
      }

      const allPathsToDelete = Array.from(new Set([...deletedFilePaths, ...modifiedOrAddedPaths]));

      await db.transaction(async (tx) => {
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

        // Insert new repository_files records for modified/added files
        if (newFiles.length > 0) {
          const FILE_BATCH_SIZE = 150;
          for (let i = 0; i < newFiles.length; i += FILE_BATCH_SIZE) {
            await tx
              .insert(repositoryFiles)
              .values(newFiles.slice(i, i + FILE_BATCH_SIZE))
              .onConflictDoNothing();
          }
        }

        // Insert new chunks for modified or added files
        if (newChunks.length > 0) {
          const DB_BATCH_SIZE = 150;
          for (let i = 0; i < newChunks.length; i += DB_BATCH_SIZE) {
            await tx
              .insert(chunks)
              .values(newChunks.slice(i, i + DB_BATCH_SIZE))
              .onConflictDoNothing();
          }
        }

        // Update repository metadata within the same transaction
        await tx
          .update(repositories)
          .set({
            headCommitSha: metadata.headCommitSha,
            indexedAt: now,
            updatedAt: now,
          })
          .where(eq(repositories.id, repositoryId));
      });

      return {
        totalChunksInserted: newChunks.length,
        totalFilesProcessed: processedFiles.length - processedFiles.filter((p) => p.error).length,
      };
    });
  }
}
