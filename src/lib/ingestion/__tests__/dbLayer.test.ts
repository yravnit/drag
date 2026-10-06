import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { IngestionDatabaseLayer, isTransientDatabaseError } from '../dbLayer';
import type { Database } from '@/db/db';
import type { RepositoryMetadata } from '../repositoryProvider';
import type { ProcessedFileResult } from '../batchProcessor';

// ─── Stub Drizzle db ──────────────────────────────────────────────────────────

type StubTx = {
  delete: Mock;
  insert: Mock;
  update: Mock;
};

function makeStubDb() {
  const tx = {
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  const stubDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };

  return { stubDb, tx };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<RepositoryMetadata> = {}): RepositoryMetadata {
  return {
    name: 'my-repo',
    owner: 'octocat',
    url: 'https://github.com/octocat/my-repo',
    defaultBranch: 'main',
    description: null,
    primaryLanguage: 'TypeScript',
    headCommitSha: 'abc123',
    ...overrides,
  };
}

function makeProcessedFile(
  relativePath: string,
  chunks: { text: string }[] = [{ text: 'code' }],
  error?: string
): ProcessedFileResult {
  return {
    file: {
      relativePath,
      absolutePath: `/tmp/${relativePath}`,
      category: 'source',
      language: 'typescript',
    },
    chunks: chunks.map((c, i) => ({
      chunkType: 'function' as const,
      symbolName: `fn${i}`,
      startLine: 1,
      endLine: 3,
      text: c.text,
      language: 'typescript',
    })),
    contentHash: 'hash-abc-123',
    sizeBytes: 100,
    error,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IngestionDatabaseLayer', () => {
  let stubDb: Record<string, Mock>;
  let tx: StubTx;

  beforeEach(() => {
    vi.clearAllMocks();
    const stub = makeStubDb();
    stubDb = stub.stubDb as unknown as Record<string, Mock>;
    tx = stub.tx;
  });

  describe('isTransientDatabaseError', () => {
    it('identifies network errors and timeout codes as transient', () => {
      expect(isTransientDatabaseError(new Error('ECONNRESET connection lost'))).toBe(true);
      expect(isTransientDatabaseError({ code: '40001', message: 'serialization failure' })).toBe(true);
      expect(isTransientDatabaseError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
    });

    it('identifies non-transient syntax/constraint errors as false', () => {
      expect(isTransientDatabaseError({ code: '23505', message: 'unique constraint error' })).toBe(false);
      expect(isTransientDatabaseError(new Error('invalid syntax at or near'))).toBe(false);
    });
  });

  describe('upsertRepository', () => {
    it('upserts repository via onConflictDoUpdate in a single query', async () => {
      const newId = 'uuid-upserted-1';

      stubDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: newId }]),
          }),
        }),
      });

      const layer = new IngestionDatabaseLayer(stubDb as unknown as Database);
      const result = await layer.upsertRepository(makeMetadata());

      expect(result).toBe(newId);
      expect(stubDb.insert).toHaveBeenCalledOnce();
    });

    it('retries on transient errors and succeeds on attempt 3', async () => {
      const newId = 'uuid-retry';
      let callCount = 0;

      stubDb.insert.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error('ECONNRESET connection reset');
        }
        return {
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: newId }]),
            }),
          }),
        };
      });

      const layer = new IngestionDatabaseLayer(stubDb as unknown as Database, {
        maxRetries: 3,
        retryDelayMs: 0,
      });
      const result = await layer.upsertRepository(makeMetadata());

      expect(result).toBe(newId);
      expect(callCount).toBe(3);
    });

    it('fails fast without retry for non-transient errors', async () => {
      stubDb.insert.mockImplementation(() => {
        throw new Error('invalid input syntax');
      });

      const layer = new IngestionDatabaseLayer(stubDb as unknown as Database, {
        maxRetries: 3,
        retryDelayMs: 0,
      });
      await expect(layer.upsertRepository(makeMetadata())).rejects.toThrow(/non-transient error/i);
    });
  });

  describe('saveRepositoryChunks', () => {
    function setupTransaction() {
      tx.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      tx.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });

      stubDb.transaction.mockImplementation(async (fn: (tx: StubTx) => Promise<void>) => {
        await fn(tx);
      });
    }

    it('runs inside a transaction (delete then insert)', async () => {
      setupTransaction();

      const layer = new IngestionDatabaseLayer(stubDb as unknown as Database);
      const files = [makeProcessedFile('src/a.ts', [{ text: 'fn' }])];

      await layer.saveRepositoryChunks('repo-123', files);

      expect(stubDb.transaction).toHaveBeenCalledOnce();
      expect(tx.delete).toHaveBeenCalledTimes(2); // chunks and repositoryFiles
      expect(tx.insert).toHaveBeenCalledTimes(2);
    });

    it('returns total count of inserted chunks', async () => {
      setupTransaction();

      const layer = new IngestionDatabaseLayer(stubDb as unknown as Database);
      const files = [
        makeProcessedFile('src/a.ts', [{ text: 'fn1' }, { text: 'fn2' }]),
        makeProcessedFile('src/b.ts', [{ text: 'fn3' }]),
      ];

      const { totalChunksInserted } = await layer.saveRepositoryChunks('repo-123', files);
      expect(totalChunksInserted).toBe(3);
    });
  });

  describe('saveIncrementalChunks', () => {
    it('deletes chunks and repositoryFiles for modified/removed files and inserts new chunks transactionally', async () => {
      tx.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      tx.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      });
      tx.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      stubDb.transaction.mockImplementation(async (fn: (tx: StubTx) => Promise<void>) => {
        await fn(tx);
      });

      const layer = new IngestionDatabaseLayer(stubDb as unknown as Database);
      const files = [makeProcessedFile('src/modified.ts', [{ text: 'newCode' }])];
      const deletedPaths = ['src/oldDeleted.ts'];

      const res = await layer.saveIncrementalChunks('repo-123', files, deletedPaths, makeMetadata());

      expect(res.totalChunksInserted).toBe(1);
      expect(stubDb.transaction).toHaveBeenCalledOnce();
      expect(tx.delete).toHaveBeenCalledTimes(2); // chunks + repository_files
      expect(tx.insert).toHaveBeenCalledTimes(2); // chunks + repository_files
      expect(tx.update).toHaveBeenCalledOnce();
    });
  });

  describe('persistProcessedFilesChunks', () => {
    it('persists chunks and files using onConflictDoNothing in batches', async () => {
      const { persistProcessedFilesChunks } = await import('../dbLayer');
      const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoNothing });
      const txMock = {
        insert: vi.fn().mockReturnValue({ values }),
      };

      const files = [
        makeProcessedFile('src/file1.ts', [{ text: 'chunk1' }]),
        makeProcessedFile('src/file2.ts', [{ text: 'chunk2' }, { text: 'chunk3' }]),
        makeProcessedFile('src/file3.ts', [], 'Syntax Error'), // with error, should be skipped
      ];

      const res = await persistProcessedFilesChunks(txMock as any, 'repo-123', files);
      expect(res.totalChunksInserted).toBe(3);
      expect(txMock.insert).toHaveBeenCalledTimes(2); // 1 for chunks, 1 for files
      expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
    });
  });
});
