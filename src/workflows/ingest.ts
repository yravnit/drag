import fs from 'fs';
import { GitHubArchiveRepositoryProvider } from '@/lib/ingestion/repositoryProvider';
import { discoverRepositoryFiles, DiscoveredFile } from '@/lib/ingestion/fileFilter';
import { TreeSitterParserManager } from '@/lib/ingestion/parserManager';
import { BatchProcessor } from '@/lib/ingestion/batchProcessor';
import { IngestionDatabaseLayer } from '@/lib/ingestion/dbLayer';
import { GitHubApiClient } from '@/lib/ingestion/githubApiClient';

export interface IngestPayload {
  owner: string;
  repo: string;
  authToken?: string;
  revision?: string; // Branch, tag, or commit SHA
  batchSize?: number;
  extraIgnorePatterns?: string[];
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

interface AcquireResult {
  metadata: import('@/lib/ingestion/repositoryProvider').RepositoryMetadata;
  filesToProcess: DiscoveredFile[];
  deletedFilePaths: string[];
  repositoryId: string;
  skipped: boolean;
  isIncremental: boolean;
  totalDiscoveredCount: number;
}

// ─── Step 1: Acquire repository & compute per-file diff ────────────────────────

async function acquireRepository(payload: IngestPayload): Promise<AcquireResult> {
  'use step';

  const { owner, repo, authToken, revision, extraIgnorePatterns } = payload;
  const apiClient = new GitHubApiClient({ authToken });
  const provider = new GitHubArchiveRepositoryProvider(apiClient);
  const dbLayer = new IngestionDatabaseLayer();

  const acquiredRepo = await provider.acquire(owner, repo, { authToken, revision });

  try {
    const { metadata, workspacePath } = acquiredRepo;
    console.log(`[Step 1] Repository acquired: ${metadata.name} (${metadata.owner}), HEAD: ${metadata.headCommitSha}`);

    const existingRepo = await dbLayer.getRepositoryByUrl(metadata.url);

    // Rule 4: Quick-skip if commit SHA matches stored repository record
    if (
      existingRepo &&
      existingRepo.headCommitSha &&
      metadata.headCommitSha &&
      existingRepo.headCommitSha === metadata.headCommitSha
    ) {
      console.log(`[Step 1] HEAD SHA (${metadata.headCommitSha}) unchanged. Skipping repository ingestion.`);
      return {
        metadata,
        filesToProcess: [],
        deletedFilePaths: [],
        repositoryId: existingRepo.id,
        skipped: true,
        isIncremental: false,
        totalDiscoveredCount: 0,
      };
    }

    const allDiscoveredFiles = await discoverRepositoryFiles(workspacePath, { extraIgnorePatterns });
    console.log(`[Step 1] Discovered ${allDiscoveredFiles.length} supported files.`);

    // Rule 5: Per-file Hash Diffing (repository_files tracking)
    if (existingRepo) {
      const trackedFilesMap = await dbLayer.getRepositoryFiles(existingRepo.id);
      console.log(`[Step 1] Incremental diffing against ${trackedFilesMap.size} previously tracked repository_files...`);

      const currentDiscoveredSet = new Set<string>();
      const filesToProcess: DiscoveredFile[] = [];

      for (const file of allDiscoveredFiles) {
        currentDiscoveredSet.add(file.relativePath);
        try {
          const content = await fs.promises.readFile(file.absolutePath, 'utf-8');
          const currentHash = BatchProcessor.computeContentHash(content);
          const previousHash = trackedFilesMap.get(file.relativePath);

          if (!previousHash || previousHash !== currentHash) {
            filesToProcess.push(file);
          }
        } catch {
          filesToProcess.push(file);
        }
      }

      const deletedFilePaths: string[] = [];
      for (const trackedPath of trackedFilesMap.keys()) {
        if (!currentDiscoveredSet.has(trackedPath)) {
          deletedFilePaths.push(trackedPath);
        }
      }

      if (filesToProcess.length === 0 && deletedFilePaths.length === 0) {
        console.log(`[Step 1] All ${allDiscoveredFiles.length} file hashes match DB. Skipping re-indexing.`);
        return {
          metadata,
          filesToProcess: [],
          deletedFilePaths: [],
          repositoryId: existingRepo.id,
          skipped: true,
          isIncremental: true,
          totalDiscoveredCount: allDiscoveredFiles.length,
        };
      }

      console.log(
        `[Step 1] Incremental hash diff: ${filesToProcess.length} modified/added files, ${deletedFilePaths.length} deleted files.`
      );

      return {
        metadata,
        filesToProcess,
        deletedFilePaths,
        repositoryId: existingRepo.id,
        skipped: false,
        isIncremental: true,
        totalDiscoveredCount: allDiscoveredFiles.length,
      };
    }

    // Initial run: Full Indexing
    const repositoryId = await dbLayer.upsertRepository(metadata);
    console.log(`[Step 1] Repository metadata upserted with ID: ${repositoryId}`);

    return {
      metadata,
      filesToProcess: allDiscoveredFiles,
      deletedFilePaths: [],
      repositoryId,
      skipped: false,
      isIncremental: false,
      totalDiscoveredCount: allDiscoveredFiles.length,
    };
  } finally {
    await acquiredRepo.cleanup();
  }
}

// ─── Step 2: Parse, chunk, and persist files ────────────────────────────────

async function parseAndPersist(
  acquireInfo: AcquireResult,
  batchSize: number
) {
  'use step';

  if (acquireInfo.skipped) {
    return { skippedFilesCount: 0, totalChunksInserted: 0, totalFilesProcessed: 0 };
  }

  const { repositoryId, filesToProcess, deletedFilePaths, isIncremental, metadata } = acquireInfo;

  const dbLayer = new IngestionDatabaseLayer();
  const parserManager = new TreeSitterParserManager();
  const batchProcessor = new BatchProcessor(parserManager, { batchSize });

  let processedFiles;
  try {
    processedFiles = await batchProcessor.processFiles(filesToProcess, (done, total) => {
      console.log(`[Step 2] Processed ${done}/${total} files...`);
    });
  } finally {
    parserManager.dispose();
  }

  const skippedFilesCount = processedFiles.filter((p) => p.error).length;
  console.log(`[Step 2] Batch complete. Succeeded: ${processedFiles.length - skippedFilesCount}, Skipped: ${skippedFilesCount}`);

  let totalChunksInserted = 0;

  if (isIncremental) {
    const res = await dbLayer.saveIncrementalChunks(repositoryId, processedFiles, deletedFilePaths, metadata);
    totalChunksInserted = res.totalChunksInserted;
    console.log(`[Step 2] Incremental save complete: ${totalChunksInserted} new/updated chunks.`);
  } else {
    const res = await dbLayer.saveRepositoryChunks(repositoryId, processedFiles);
    totalChunksInserted = res.totalChunksInserted;
    console.log(`[Step 2] Full save complete: Inserted ${totalChunksInserted} chunks into PostgreSQL.`);
  }

  return { skippedFilesCount, totalChunksInserted, totalFilesProcessed: processedFiles.length - skippedFilesCount };
}

// ─── Workflow Orchestrator ──────────────────────────────────────────────────

export async function ingestRepository(payload: IngestPayload): Promise<IngestResult> {
  'use workflow';

  if (!payload.owner || !payload.repo) {
    throw new Error('Missing required fields: "owner" and "repo"');
  }

  const startTime = Date.now();
  console.log(`[Workflow] Starting ingestion for ${payload.owner}/${payload.repo}`);

  // Step 1: Download, discover files, compute per-file hash diff, upsert metadata
  const acquireInfo = await acquireRepository(payload);

  // Step 2: Parse, chunk, and persist (skip if unchanged)
  const { skippedFilesCount, totalChunksInserted, totalFilesProcessed } = await parseAndPersist(
    acquireInfo,
    payload.batchSize ?? 10
  );

  const durationMs = Date.now() - startTime;
  console.log(`[Workflow] Completed in ${durationMs}ms`);

  return {
    success: true,
    skipped: acquireInfo.skipped,
    repositoryId: acquireInfo.repositoryId,
    repositoryName: acquireInfo.metadata.name,
    owner: acquireInfo.metadata.owner,
    url: acquireInfo.metadata.url,
    headCommitSha: acquireInfo.metadata.headCommitSha,
    totalFilesDiscovered: acquireInfo.totalDiscoveredCount,
    totalFilesProcessed,
    totalChunksInserted,
    skippedFilesCount,
    durationMs,
    isIncremental: acquireInfo.isIncremental,
  };
}
