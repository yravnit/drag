import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DiscoveredFile } from '../fileFilter';
import type { RawChunk } from '../semanticChunker';
import { BatchProcessor } from '../batchProcessor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(relativePath: string, absolutePath: string, language: DiscoveredFile['language'] = 'typescript'): DiscoveredFile {
  return { relativePath, absolutePath, category: 'source', language };
}

function makeChunk(overrides: Partial<RawChunk> = {}): RawChunk {
  return {
    chunkType: 'function',
    symbolName: 'myFn',
    startLine: 1,
    endLine: 5,
    text: 'function myFn() {}',
    language: 'typescript',
    ...overrides,
  };
}

type InternalProcessor = {
  chunker: { chunkFile: (file: DiscoveredFile, content: string) => Promise<RawChunk[]> };
};

// ─── Temp-dir fixture ─────────────────────────────────────────────────────────
// We write real files so batchProcessor.ts's fs.promises.readFile succeeds.

let tmpDir: string;

async function writeTmpFile(name: string, content = '// stub'): Promise<DiscoveredFile> {
  const absPath = path.join(tmpDir, name);
  await fs.promises.writeFile(absPath, content);
  return makeFile(name, absPath);
}

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bp-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeMockBatchProcessor(
  chunkFileImpl: (file: DiscoveredFile, content: string) => Promise<RawChunk[]>,
  batchSize = 3,
  extraOptions: { spillChunksTo?: string } = {},
): BatchProcessor {
  const fakeParserManager = {} as ConstructorParameters<typeof BatchProcessor>[0];
  const processor = new BatchProcessor(fakeParserManager, { batchSize, ...extraOptions });
  (processor as unknown as InternalProcessor).chunker = { chunkFile: chunkFileImpl };
  return processor;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BatchProcessor', () => {
  it('returns one result per file', async () => {
    const files = await Promise.all([writeTmpFile('a.ts'), writeTmpFile('b.ts'), writeTmpFile('c.ts')]);
    const processor = makeMockBatchProcessor(async () => [makeChunk()]);

    const results = await processor.processFiles(files);
    expect(results).toHaveLength(3);
  });

  it('includes chunks in each result', async () => {
    const files = [await writeTmpFile('a.ts')];
    const chunk = makeChunk({ symbolName: 'hello' });
    const processor = makeMockBatchProcessor(async () => [chunk]);

    const [result] = await processor.processFiles(files);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].symbolName).toBe('hello');
  });

  it('skips individual file errors (chunker throws) and captures the error message', async () => {
    const files = await Promise.all([
      writeTmpFile('good.ts'),
      writeTmpFile('bad.ts'),
      writeTmpFile('also-good.ts'),
    ]);

    const processor = makeMockBatchProcessor(async (file) => {
      if (file.relativePath === 'bad.ts') throw new Error('parse failure');
      return [makeChunk()];
    });

    const results = await processor.processFiles(files);
    expect(results).toHaveLength(3);

    const bad = results.find((r) => r.file.relativePath === 'bad.ts')!;
    expect(bad.error).toBe('parse failure');
    expect(bad.chunks).toHaveLength(0);

    expect(results.filter((r) => !r.error)).toHaveLength(2);
  });

  it('continues processing after a batch that contains an error', async () => {
    // batchSize=2: [a, b] is batch-1, [c] is batch-2
    const files = await Promise.all([
      writeTmpFile('a.ts'),
      writeTmpFile('b.ts'),
      writeTmpFile('c.ts'),
    ]);

    const processor = makeMockBatchProcessor(async (file) => {
      if (file.relativePath === 'b.ts') throw new Error('oops');
      return [makeChunk()];
    }, 2);

    const results = await processor.processFiles(files);
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.file.relativePath === 'c.ts')?.chunks).toHaveLength(1);
  });

  it('calls onProgress with the correct counts', async () => {
    const files = await Promise.all([
      writeTmpFile('a.ts'),
      writeTmpFile('b.ts'),
      writeTmpFile('c.ts'),
      writeTmpFile('d.ts'),
    ]);
    const processor = makeMockBatchProcessor(async () => [makeChunk()], 2);

    const calls: [number, number][] = [];
    await processor.processFiles(files, (done, total) => calls.push([done, total]));

    // batchSize=2, 4 files → 2 batches → 2 progress events
    expect(calls).toEqual([
      [2, 4],
      [4, 4],
    ]);
  });

  it('returns empty array when given no files', async () => {
    const processor = makeMockBatchProcessor(async () => [makeChunk()]);
    const results = await processor.processFiles([]);
    expect(results).toHaveLength(0);
  });

  it('handles files that produce zero chunks without marking them as errors', async () => {
    const files = [await writeTmpFile('empty.ts')];
    const processor = makeMockBatchProcessor(async () => []);

    const [result] = await processor.processFiles(files);
    expect(result.chunks).toHaveLength(0);
    expect(result.error).toBeUndefined();
  });

  it('respects custom batchSize — fires one progress event per batch', async () => {
    const files = await Promise.all(
      Array.from({ length: 5 }, (_, i) => writeTmpFile(`file${i}.ts`)),
    );
    const calls: [number, number][] = [];
    const processor = makeMockBatchProcessor(async () => [makeChunk()], 1);

    await processor.processFiles(files, (done, total) => calls.push([done, total]));

    // batchSize=1 → 5 batches → 5 events
    expect(calls).toHaveLength(5);
    expect(calls[4]).toEqual([5, 5]);
  });

  it('captures readFile errors as per-file errors (not crashes)', async () => {
    // Point absolutePath to a non-existent file so readFile throws ENOENT
    const missingFile = makeFile('missing.ts', path.join(tmpDir, 'does-not-exist.ts'));
    const fakeParserManager = {} as ConstructorParameters<typeof BatchProcessor>[0];
    const processor = new BatchProcessor(fakeParserManager, { batchSize: 5 });

    const results = await processor.processFiles([missingFile]);

    expect(results[0].error).toBeDefined();
    expect(results[0].chunks).toHaveLength(0);
  });

  it('spills chunks to a temp JSON file when spillChunksTo is set', async () => {
    const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-spill-'));
    try {
      const chunk = makeChunk({ symbolName: 'spilled' });
      const files = [await writeTmpFile('a.ts')];
      const processor = makeMockBatchProcessor(async () => [chunk], 3, {
        spillChunksTo: spillDir,
      });

      const [result] = await processor.processFiles(files);

      expect(result.error).toBeUndefined();
      expect(result.tempChunksPath).toBeDefined();
      expect(result.chunks).toHaveLength(0);
      expect(fs.existsSync(result.tempChunksPath!)).toBe(true);

      const roundTripped = JSON.parse(fs.readFileSync(result.tempChunksPath!, 'utf-8'));
      expect(roundTripped).toEqual([chunk]);
    } finally {
      await fs.promises.rm(spillDir, { recursive: true, force: true });
    }
  });

  it('does not spill when the file produces zero chunks', async () => {
    const spillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-spill-'));
    try {
      const files = [await writeTmpFile('empty.ts')];
      const processor = makeMockBatchProcessor(async () => [], 3, {
        spillChunksTo: spillDir,
      });

      const [result] = await processor.processFiles(files);

      expect(result.error).toBeUndefined();
      expect(result.tempChunksPath).toBeUndefined();
      expect(fs.readdirSync(spillDir)).toHaveLength(0);
    } finally {
      await fs.promises.rm(spillDir, { recursive: true, force: true });
    }
  });

  it('keeps chunks in memory when spillChunksTo is not set', async () => {
    const chunk = makeChunk();
    const files = [await writeTmpFile('a.ts')];
    const processor = makeMockBatchProcessor(async () => [chunk]);

    const [result] = await processor.processFiles(files);

    expect(result.tempChunksPath).toBeUndefined();
    expect(result.chunks).toEqual([chunk]);
  });
});
