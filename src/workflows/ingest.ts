import fs from "fs";
import path from "path";
import { db } from "@/db/db";
import { GitHubArchiveRepositoryProvider } from "@/lib/ingestion/repositoryProvider";
import { discoverRepositoryFiles, DiscoveredFile } from "@/lib/ingestion/fileFilter";
import { TreeSitterParserManager } from "@/lib/ingestion/parserManager";
import { BatchProcessor, ProcessedFileResult } from "@/lib/ingestion/batchProcessor";
import { IngestionDatabaseLayer } from "@/lib/ingestion/dbLayer";
import { GitHubApiClient } from "@/lib/ingestion/githubApiClient";
import { start } from "workflow/api";
import { embedRepository } from "@/workflows/embed";
import { userRepositories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserEntitlements } from "@/lib/plans/entitlements";
import { clearEmbeddingLease } from "@/lib/leases/repositoryLeases";

export interface IngestPayload {
  owner: string;
  repo: string;
  authToken?: string;
  revision?: string; // Branch, tag, or commit SHA
  batchSize?: number;
  extraIgnorePatterns?: string[];
  userId?: string;
}

export interface IngestResult {
  success: boolean;
  skipped: boolean;
  repositoryId: string;
  repositoryName: string;
  owner: string;
  url: string;
  headCommitSha: string | null;
  totalFilesDiscovered: number;
  totalFilesProcessed: number;
  totalChunksInserted: number;
  skippedFilesCount: number;
  durationMs: number;
  isIncremental?: boolean;
}

// ─── Step 1: Run Ingestion (Acquire, Diff, Parse, Chunk, and Persist) ─────────

async function runIngestionStep(
  payload: IngestPayload,
  batchSize: number,
): Promise<{
  skipped: boolean;
  repositoryId: string;
  repositoryName: string;
  owner: string;
  url: string;
  headCommitSha: string | null;
  totalFilesDiscovered: number;
  totalFilesProcessed: number;
  totalChunksInserted: number;
  skippedFilesCount: number;
  isIncremental: boolean;
}> {
  "use step";

  const { owner, repo, authToken, revision, extraIgnorePatterns } = payload;
  const apiClient = new GitHubApiClient({ authToken });
  const provider = new GitHubArchiveRepositoryProvider(apiClient);
  const dbLayer = new IngestionDatabaseLayer(db);

  const acquiredRepo = await provider.acquire(owner, repo, { authToken, revision });

  try {
    const { metadata, workspacePath } = acquiredRepo;
    console.log(
      `[Step] Repository acquired: ${metadata.name} (${metadata.owner}), HEAD: ${metadata.headCommitSha}`,
    );

    const existingRepo = metadata.githubId
      ? await dbLayer.getRepositoryByGithubId(metadata.githubId)
      : await dbLayer.getRepositoryByUrl(metadata.url);

    // Rule 4: Quick-skip if commit SHA matches stored repository record and repository was already indexed
    if (
      existingRepo &&
      existingRepo.indexedAt &&
      existingRepo.embeddingStatus === "ready" &&
      existingRepo.headCommitSha &&
      metadata.headCommitSha &&
      existingRepo.headCommitSha === metadata.headCommitSha
    ) {
      console.log(
        `[Step] HEAD SHA (${metadata.headCommitSha}) unchanged. Skipping repository ingestion.`,
      );
      return {
        skipped: true,
        repositoryId: existingRepo.id,
        repositoryName: metadata.name,
        owner: metadata.owner,
        url: metadata.url,
        headCommitSha: metadata.headCommitSha,
        totalFilesDiscovered: 0,
        totalFilesProcessed: 0,
        totalChunksInserted: 0,
        skippedFilesCount: 0,
        isIncremental: false,
      };
    }

    const allDiscoveredFiles = await discoverRepositoryFiles(workspacePath, {
      extraIgnorePatterns,
    });
    console.log(`[Step] Discovered ${allDiscoveredFiles.length} supported files.`);

    const filesToProcess: DiscoveredFile[] = [];
    const deletedFilePaths: string[] = [];
    let isIncremental = false;
    let repositoryId = existingRepo?.id || "";

    // Rule 5: Per-file Hash Diffing (repository_files tracking)
    if (existingRepo) {
      const trackedFilesMap = await dbLayer.getRepositoryFiles(existingRepo.id);

      // Check whether user/plan permits incremental reindexing.
      // Only enforced when the repository was actually indexed before: POST /api/repos inserts
      // the repositories row before starting this workflow, so existingRepo is always set on the
      // very first ingest. Gating on tracked files keeps first-time ingestion working on Free.
      let ownerUserId = payload.userId;
      if (!ownerUserId) {
        try {
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              existingRepo.id,
            );
          if (isUuid) {
            const assocs = await db
              .select({ userId: userRepositories.userId })
              .from(userRepositories)
              .where(eq(userRepositories.repositoryId, existingRepo.id));
            ownerUserId = assocs.find((a) => a.userId)?.userId;
          }
        } catch (err) {
          console.warn("[Step] Association lookup failed, skipping entitlement check:", err);
        }
      }

      if (ownerUserId && trackedFilesMap.size > 0) {
        const entitlements = await getUserEntitlements(db, ownerUserId);
        if (!entitlements.incrementalReindexAllowed) {
          throw new Error(
            "Incremental reindexing is disabled on the Free plan. Upgrade to Hobby to enable incremental reindexing.",
          );
        }
      }

      isIncremental = true;
      console.log(
        `[Step] Incremental diffing against ${trackedFilesMap.size} previously tracked repository_files...`,
      );

      const currentDiscoveredSet = new Set<string>();

      for (const file of allDiscoveredFiles) {
        currentDiscoveredSet.add(file.relativePath);
        try {
          const content = await fs.promises.readFile(file.absolutePath, "utf-8");
          const currentHash = BatchProcessor.computeContentHash(content);
          const previousHash = trackedFilesMap.get(file.relativePath);

          if (!previousHash || previousHash !== currentHash) {
            filesToProcess.push(file);
          }
        } catch {
          filesToProcess.push(file);
        }
      }

      for (const trackedPath of trackedFilesMap.keys()) {
        if (!currentDiscoveredSet.has(trackedPath)) {
          deletedFilePaths.push(trackedPath);
        }
      }

      if (filesToProcess.length === 0 && deletedFilePaths.length === 0) {
        console.log(
          `[Step] All ${allDiscoveredFiles.length} file hashes match DB. Skipping re-indexing.`,
        );
        // Persist the new Git commit SHA so subsequent syncs do not repeatedly re-process this commit
        if (metadata.headCommitSha && existingRepo.headCommitSha !== metadata.headCommitSha) {
          await dbLayer.updateHeadCommitSha(existingRepo.id, metadata.headCommitSha);
        }
        return {
          skipped: true,
          repositoryId: existingRepo.id,
          repositoryName: metadata.name,
          owner: metadata.owner,
          url: metadata.url,
          headCommitSha: metadata.headCommitSha,
          totalFilesDiscovered: allDiscoveredFiles.length,
          totalFilesProcessed: 0,
          totalChunksInserted: 0,
          skippedFilesCount: 0,
          isIncremental: true,
        };
      }

      console.log(
        `[Step] Incremental hash diff: ${filesToProcess.length} modified/added files, ${deletedFilePaths.length} deleted files.`,
      );
    } else {
      // Initial run: Full Indexing
      repositoryId = await dbLayer.upsertRepository(metadata);
      console.log(`[Step] Repository metadata upserted with ID: ${repositoryId}`);
      filesToProcess.push(...allDiscoveredFiles);
    }

    const parserManager = new TreeSitterParserManager();
    const batchProcessor = new BatchProcessor(parserManager, { batchSize });
    const processedFiles: ProcessedFileResult[] = [];

    try {
      const fileBatchSize = batchSize;
      for (let i = 0; i < filesToProcess.length; i += fileBatchSize) {
        const batch = filesToProcess.slice(i, i + fileBatchSize);
        const batchResults = await batchProcessor.processFiles(batch);

        for (const res of batchResults) {
          if (res.error) {
            console.warn(
              `[Step] Warning: Failed to process file ${res.file.relativePath}: ${res.error}. Skipping file.`,
            );
          }

          if (res.chunks && res.chunks.length > 0) {
            const safeName = res.file.relativePath.replace(/[^a-zA-Z0-9.-]/g, "_");
            const tempPath = path.join(
              workspacePath,
              `chunks_${safeName}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.json`,
            );
            await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
            await fs.promises.writeFile(tempPath, JSON.stringify(res.chunks), "utf-8");
            res.chunks = [];
            res.tempChunksPath = tempPath;
          }

          processedFiles.push(res);
        }

        console.log(
          `[Step] Processed ${Math.min(i + fileBatchSize, filesToProcess.length)}/${filesToProcess.length} files...`,
        );
      }
    } finally {
      parserManager.dispose();
    }

    const skippedFilesCount = processedFiles.filter((p) => p.error).length;
    console.log(
      `[Step] Batch complete. Succeeded: ${processedFiles.length - skippedFilesCount}, Skipped: ${skippedFilesCount}`,
    );

    let totalChunksInserted = 0;

    if (isIncremental) {
      const res = await dbLayer.saveIncrementalChunks(
        repositoryId,
        processedFiles,
        deletedFilePaths,
        metadata,
      );
      totalChunksInserted = res.totalChunksInserted;
      console.log(`[Step] Incremental save complete: ${totalChunksInserted} new/updated chunks.`);
    } else {
      const res = await dbLayer.saveRepositoryChunks(repositoryId, processedFiles);
      totalChunksInserted = res.totalChunksInserted;
      console.log(
        `[Step] Full save complete: Inserted ${totalChunksInserted} chunks into PostgreSQL.`,
      );
    }

    return {
      skipped: false,
      repositoryId,
      repositoryName: metadata.name,
      owner: metadata.owner,
      url: metadata.url,
      headCommitSha: metadata.headCommitSha,
      totalFilesDiscovered: allDiscoveredFiles.length,
      totalFilesProcessed: processedFiles.length - skippedFilesCount,
      totalChunksInserted,
      skippedFilesCount,
      isIncremental,
    };
  } finally {
    await acquiredRepo.cleanup();
  }
}

async function triggerEmbeddingsStep(repositoryId: string): Promise<void> {
  "use step";
  console.log(`[Step] Triggering embeddings workflow for repository ID: ${repositoryId}`);
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      repositoryId,
    );
  if (isUuid) {
    try {
      await clearEmbeddingLease(db, repositoryId);
    } catch {
      // Ignore in mock or test environments
    }
  }
  await start(embedRepository, [{ repositoryId }]);
}

// ─── Workflow Orchestrator ──────────────────────────────────────────────────

export async function ingestRepository(payload: IngestPayload): Promise<IngestResult> {
  "use workflow";

  if (!payload.owner || !payload.repo) {
    throw new Error('Missing required fields: "owner" and "repo"');
  }

  const startTime = Date.now();
  console.log(`[Workflow] Starting ingestion for ${payload.owner}/${payload.repo}`);

  const stepResult = await runIngestionStep(payload, payload.batchSize ?? 10);

  if (!stepResult.skipped && stepResult.repositoryId) {
    await triggerEmbeddingsStep(stepResult.repositoryId);
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Workflow] Completed in ${durationMs}ms`);

  return {
    success: true,
    ...stepResult,
    durationMs,
  };
}
