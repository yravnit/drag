import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

const {
  mockAcquire,
  mockDiscover,
  mockGetRepositoryByUrl,
  mockGetRepositoryFiles,
  mockUpsert,
  mockSaveChunks,
  mockSaveIncrementalChunks,
  mockCompareCommits,
  mockProcessFiles,
  mockDispose,
  mockStart,
  mockGetRepositoryByGithubId,
  mockUpdateHeadCommitSha,
  mockGetUserEntitlements,
} = vi.hoisted(() => ({
  mockAcquire: vi.fn(),
  mockDiscover: vi.fn(),
  mockGetRepositoryByUrl: vi.fn(),
  mockGetRepositoryFiles: vi.fn(),
  mockUpsert: vi.fn(),
  mockSaveChunks: vi.fn(),
  mockSaveIncrementalChunks: vi.fn(),
  mockCompareCommits: vi.fn(),
  mockProcessFiles: vi.fn(),
  mockDispose: vi.fn(),
  mockStart: vi.fn(),
  mockGetRepositoryByGithubId: vi.fn(),
  mockUpdateHeadCommitSha: vi.fn(),
  mockGetUserEntitlements: vi.fn(),
}));

vi.mock('@/lib/plans/entitlements', () => ({
  getUserEntitlements: (...args: any[]) => mockGetUserEntitlements(...args),
}));

const FREE_ENTITLEMENTS = {
  plan: 'free',
  repositoryLimit: 2,
  monthlyQueryLimit: 25,
  repositorySizeLimitBytes: 50 * 1024 * 1024,
  fileLimit: 2500,
  allowedBranch: 'main',
  incrementalReindexAllowed: false,
};

const HOBBY_ENTITLEMENTS = {
  ...FREE_ENTITLEMENTS,
  plan: 'hobby',
  repositoryLimit: 10,
  fileLimit: 12500,
  allowedBranch: '*',
  incrementalReindexAllowed: true,
};

vi.mock('workflow/api', () => ({
  start: mockStart,
}));

vi.mock('@/workflows/embed', () => ({
  embedRepository: vi.fn(),
}));

vi.mock('@/lib/ingestion/githubApiClient', () => {
  return {
    GitHubApiClient: class {
      compareCommits = mockCompareCommits;
    },
  };
});

vi.mock('@/lib/ingestion/repositoryProvider', () => {
  return {
    GitHubArchiveRepositoryProvider: class {
      acquire = mockAcquire;
    },
  };
});

vi.mock('@/lib/ingestion/fileFilter', () => ({
  discoverRepositoryFiles: mockDiscover,
}));

vi.mock('@/lib/ingestion/parserManager', () => {
  return {
    TreeSitterParserManager: class {
      dispose = mockDispose;
    },
  };
});

vi.mock('@/lib/ingestion/batchProcessor', () => {
  return {
    BatchProcessor: class {
      constructor(_pm: unknown, public options: unknown) {}
      static computeContentHash(content: string) {
        return 'hash-' + content.length;
      }
      processFiles = mockProcessFiles;
    },
  };
});

vi.mock('@/lib/ingestion/dbLayer', () => {
  return {
    IngestionDatabaseLayer: class {
      getRepositoryByUrl = mockGetRepositoryByUrl;
      getRepositoryByGithubId = mockGetRepositoryByGithubId;
      updateHeadCommitSha = mockUpdateHeadCommitSha;
      getRepositoryFiles = mockGetRepositoryFiles;
      upsertRepository = mockUpsert;
      saveRepositoryChunks = mockSaveChunks;
      saveIncrementalChunks = mockSaveIncrementalChunks;
    },
  };
});

import { ingestRepository, type IngestPayload } from '../../workflows/ingest';

const FAKE_METADATA = {
  name: 'drag',
  owner: 'octocat',
  url: 'https://github.com/octocat/drag',
  defaultBranch: 'main',
  description: null,
  primaryLanguage: 'TypeScript',
  headCommitSha: 'deadbeef',
};

const FAKE_FILES = [
  { relativePath: 'src/index.ts', absolutePath: '/tmp/src/index.ts', category: 'source', language: 'typescript' },
  { relativePath: 'README.md', absolutePath: '/tmp/README.md', category: 'project', language: 'markdown' },
];

const FAKE_PROCESSED = FAKE_FILES.map((f) => ({
  file: f,
  chunks: [{ chunkType: 'function', symbolName: 'fn', startLine: 1, endLine: 3, text: 'fn', language: f.language }],
  contentHash: 'hash-10',
  sizeBytes: 10,
}));

const DEFAULT_PAYLOAD: IngestPayload = { owner: 'octocat', repo: 'drag' };
const FREE_UUID = '11111111-2222-3333-4444-555555555555';

describe('ingestRepository workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockAcquire.mockResolvedValue({ metadata: FAKE_METADATA, workspacePath: '/tmp/repo', cleanup });
    mockGetRepositoryByUrl.mockResolvedValue(null);
    mockGetRepositoryFiles.mockResolvedValue(new Map());
    mockDiscover.mockResolvedValue(FAKE_FILES);
    mockUpsert.mockResolvedValue('repo-uuid-123');
    mockProcessFiles.mockResolvedValue(FAKE_PROCESSED);
    mockSaveChunks.mockResolvedValue({ totalChunksInserted: 2 });
    mockSaveIncrementalChunks.mockResolvedValue({ totalChunksInserted: 1, totalFilesProcessed: 1 });
    mockGetUserEntitlements.mockResolvedValue(HOBBY_ENTITLEMENTS);
  });

  it('returns a success result with full indexing on new repository', async () => {
    const result = await ingestRepository(DEFAULT_PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.repositoryId).toBe('repo-uuid-123');
    expect(result.repositoryName).toBe('drag');
    expect(result.owner).toBe('octocat');
    expect(result.url).toBe('https://github.com/octocat/drag');
    expect(result.headCommitSha).toBe('deadbeef');
    expect(result.totalFilesDiscovered).toBe(2);
    expect(result.totalFilesProcessed).toBe(2);
    expect(result.totalChunksInserted).toBe(2);
    expect(mockStart).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(expect.any(Function), [{ repositoryId: 'repo-uuid-123' }]);
  });

  it('skips indexing when repository headCommitSha is unchanged', async () => {
    mockGetRepositoryByUrl.mockResolvedValue({
      id: 'repo-uuid-existing',
      headCommitSha: 'deadbeef', // Matches FAKE_METADATA.headCommitSha
      indexedAt: new Date(),
      embeddingStatus: 'ready',
    });

    const result = await ingestRepository(DEFAULT_PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.repositoryId).toBe('repo-uuid-existing');
    expect(result.totalFilesProcessed).toBe(0);
    expect(result.totalChunksInserted).toBe(0);
    expect(mockProcessFiles).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('performs incremental indexing when headCommitSha changes and per-file diff detected', async () => {
    mockGetRepositoryByUrl.mockResolvedValue({
      id: 'repo-uuid-existing',
      headCommitSha: 'oldsha123',
    });

    // DB has old hash for src/index.ts
    const trackedMap = new Map<string, string>();
    trackedMap.set('src/index.ts', 'old-hash');
    trackedMap.set('deleted.ts', 'old-hash-2');
    mockGetRepositoryFiles.mockResolvedValue(trackedMap);

    mockProcessFiles.mockResolvedValue([FAKE_PROCESSED[0]]);

    const result = await ingestRepository(DEFAULT_PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.isIncremental).toBe(true);
    expect(result.repositoryId).toBe('repo-uuid-existing');
    expect(mockSaveIncrementalChunks).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(expect.any(Function), [{ repositoryId: 'repo-uuid-existing' }]);
  });

  it('throws when owner is missing', async () => {
    await expect(ingestRepository({ owner: '', repo: 'drag' })).rejects.toThrow(/owner/i);
  });

  it('throws when repo is missing', async () => {
    await expect(ingestRepository({ owner: 'octocat', repo: '' })).rejects.toThrow(/repo/i);
  });

  it('calls cleanup() even if processFiles throws', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockAcquire.mockResolvedValue({ metadata: FAKE_METADATA, workspacePath: '/tmp/repo', cleanup });
    mockProcessFiles.mockRejectedValue(new Error('WASM crash'));

    await expect(ingestRepository(DEFAULT_PAYLOAD)).rejects.toThrow('WASM crash');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('skips a single invalid file and continues processing valid files during initial ingestion', async () => {
    const validFile1 = { relativePath: 'src/valid1.ts', absolutePath: '/tmp/src/valid1.ts', category: 'source', language: 'typescript' };
    const invalidFile = { relativePath: 'src/bad.ts', absolutePath: '/tmp/src/bad.ts', category: 'source', language: 'typescript' };
    const validFile2 = { relativePath: 'src/valid2.ts', absolutePath: '/tmp/src/valid2.ts', category: 'source', language: 'typescript' };

    mockDiscover.mockResolvedValue([validFile1, invalidFile, validFile2]);
    mockProcessFiles.mockResolvedValue([
      { file: validFile1, chunks: [{ chunkType: 'function', text: 'valid1', startLine: 1, endLine: 5, symbolName: 'v1', language: 'typescript' }], contentHash: 'h1', sizeBytes: 10 },
      { file: invalidFile, chunks: [], error: 'Syntax parser error', contentHash: 'h2', sizeBytes: 10 },
      { file: validFile2, chunks: [{ chunkType: 'function', text: 'valid2', startLine: 1, endLine: 5, symbolName: 'v2', language: 'typescript' }], contentHash: 'h3', sizeBytes: 10 },
    ]);

    const result = await ingestRepository(DEFAULT_PAYLOAD);

    expect(result.success).toBe(true);
    expect(result.skippedFilesCount).toBe(1);
    expect(result.totalFilesProcessed).toBe(2);
    expect(mockSaveChunks).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(expect.any(Function), [{ repositoryId: 'repo-uuid-123' }]);
  });

  it('advances headCommitSha when git commit changes only ignored files', async () => {
    mockGetRepositoryByUrl.mockResolvedValue({
      id: 'repo-uuid-existing',
      headCommitSha: 'old-commit-sha',
    });

    const trackedMap = new Map<string, string>();
    trackedMap.set('src/index.ts', 'hash-10');
    trackedMap.set('README.md', 'hash-10');
    mockGetRepositoryFiles.mockResolvedValue(trackedMap);

    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockResolvedValue('0123456789' as any); // length 10 -> hash-10

    // Both files have matching hashes (only ignored files changed in Git commit)
    const result = await ingestRepository(DEFAULT_PAYLOAD);

    readFileSpy.mockRestore();

    expect(result.skipped).toBe(true);
    expect(mockUpdateHeadCommitSha).toHaveBeenCalledWith('repo-uuid-existing', 'deadbeef');
  });

  it('uses githubId to look up and update renamed or transferred repositories', async () => {    const renamedMetadata = {
      ...FAKE_METADATA,
      githubId: BigInt(998877),
      name: 'new-name',
      owner: 'new-owner',
      url: 'https://github.com/new-owner/new-name',
    };

    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockAcquire.mockResolvedValue({ metadata: renamedMetadata, workspacePath: '/tmp/repo', cleanup });
    mockGetRepositoryByGithubId.mockResolvedValue({
      id: 'repo-uuid-existing',
      headCommitSha: 'old-sha',
      githubId: BigInt(998877),
    });

    mockGetRepositoryFiles.mockResolvedValue(new Map());
    mockProcessFiles.mockResolvedValue(FAKE_PROCESSED);

    const result = await ingestRepository(DEFAULT_PAYLOAD);

    expect(mockGetRepositoryByGithubId).toHaveBeenCalledWith(BigInt(998877));
    expect(result.repositoryId).toBe('repo-uuid-existing');
    expect(mockSaveIncrementalChunks).toHaveBeenCalledOnce();
  });

  it('does not block first-time ingestion on a Free plan for a route-created repository', async () => {
    // POST /api/repos inserts the repositories row before starting this workflow, so the
    // repository always exists on the first ingest. No tracked files means nothing was indexed
    // yet, so the incremental-reindex entitlement must not apply.
    mockGetUserEntitlements.mockResolvedValue(FREE_ENTITLEMENTS);

    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockAcquire.mockResolvedValue({
      metadata: { ...FAKE_METADATA, githubId: BigInt(4242) },
      workspacePath: '/tmp/repo',
      cleanup,
    });
    mockGetRepositoryByGithubId.mockResolvedValue({
      id: FREE_UUID,
      githubId: BigInt(4242),
      headCommitSha: null,
      indexedAt: null,
      embeddingStatus: 'processing',
    });
    mockGetRepositoryFiles.mockResolvedValue(new Map());

    const result = await ingestRepository({
      owner: 'octocat',
      repo: 'drag',
      userId: 'free-user',
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(mockSaveIncrementalChunks).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledWith(expect.any(Function), [{ repositoryId: FREE_UUID }]);
  });

  it('still blocks incremental reindexing on Free for an already indexed repository', async () => {
    mockGetUserEntitlements.mockResolvedValue(FREE_ENTITLEMENTS);

    const cleanup = vi.fn().mockResolvedValue(undefined);
    mockAcquire.mockResolvedValue({
      metadata: { ...FAKE_METADATA, githubId: BigInt(4242) },
      workspacePath: '/tmp/repo',
      cleanup,
    });
    mockGetRepositoryByGithubId.mockResolvedValue({
      id: FREE_UUID,
      githubId: BigInt(4242),
      headCommitSha: 'oldsha123',
      indexedAt: new Date(),
      embeddingStatus: 'ready',
    });
    mockGetRepositoryFiles.mockResolvedValue(new Map([['src/index.ts', 'old-hash']]));

    await expect(
      ingestRepository({ owner: 'octocat', repo: 'drag', userId: 'free-user' }),
    ).rejects.toThrow(/Incremental reindexing is disabled/);

    expect(mockSaveIncrementalChunks).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
