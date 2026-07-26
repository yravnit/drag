import fs from 'fs';
import path from 'path';
import os from 'os';
import { RepositoryProvider, AcquiredRepository } from './repositoryProvider';
import { discoverRepositoryFiles } from './fileFilter';
import { TreeSitterParserManager } from './parserManager';
import { BatchProcessor } from './batchProcessor';
import { IngestionDatabaseLayer } from './dbLayer';
import { ProcessedFileResult } from './batchProcessor';

/**
 * Mock Repository Provider for end-to-end testing without external network calls.
 *
 * Note: The production workflow uses Vercel Workflow SDK directives ("use workflow" / "use step")
 * which require the compiler transform at build time. This test harness directly invokes the
 * underlying ingestion modules to validate logic without needing the SDK runtime.
 */
class MockRepositoryProvider implements RepositoryProvider {
  async acquire(owner: string, repo: string): Promise<AcquiredRepository> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mock-repo-ingest-'));

    // Create mock file structure
    await fs.promises.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.promises.mkdir(path.join(tempDir, 'node_modules', 'foo'), { recursive: true });
    await fs.promises.mkdir(path.join(tempDir, '.github', 'workflows'), { recursive: true });

    // 1. Source files
    await fs.promises.writeFile(
      path.join(tempDir, 'src', 'index.ts'),
      `
// Entry point
import { processItem } from './item';

/**
 * Main application runner
 */
export function run(): void {
  console.log("App running");
  processItem("test");
}
      `.trim()
    );

    await fs.promises.writeFile(
      path.join(tempDir, 'src', 'item.ts'),
      `
// Item module
export class ItemProcessor {
  /**
   * Process a single item
   */
  public process(name: string): string {
    return "Processed: " + name;
  }
}

export function processItem(name: string): string {
  const processor = new ItemProcessor();
  return processor.process(name);
}
      `.trim()
    );

    await fs.promises.writeFile(
      path.join(tempDir, 'src', 'helper.py'),
      `
# Helper python module
def format_data(val: str) -> str:
    """Format string value."""
    return val.strip().upper()
      `.trim()
    );

    // 2. Project files
    await fs.promises.writeFile(path.join(tempDir, 'README.md'), '# Mock Repository\nSample project for ingestion testing.');
    await fs.promises.writeFile(path.join(tempDir, 'package.json'), '{\n  "name": "mock-repo",\n  "version": "1.0.0"\n}');
    await fs.promises.writeFile(path.join(tempDir, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest');

    // 3. Ignored files (should NOT be discovered)
    await fs.promises.writeFile(path.join(tempDir, 'node_modules', 'foo', 'index.js'), 'console.log("ignored");');
    await fs.promises.writeFile(path.join(tempDir, 'package-lock.json'), '{}');
    await fs.promises.writeFile(path.join(tempDir, 'src', 'logo.png'), 'fake binary content');

    return {
      metadata: {
        name: repo,
        owner,
        url: `https://github.com/${owner}/${repo}`,
        defaultBranch: 'main',
        description: 'Mock test repository',
        primaryLanguage: 'TypeScript',
        headCommitSha: 'a1b2c3d4e5f6',
      },
      workspacePath: tempDir,
      cleanup: async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      },
    };
  }
}

/**
 * Mock Database Layer for testing persistence logic
 */
class MockDatabaseLayer extends IngestionDatabaseLayer {
  public upsertedRepo: any = null;
  public savedChunks: any[] = [];

  public override async upsertRepository(metadata: any): Promise<string> {
    this.upsertedRepo = metadata;
    return 'test-repo-uuid-1234';
  }

  public override async saveRepositoryChunks(repositoryId: string, processedFiles: ProcessedFileResult[]): Promise<{ totalChunksInserted: number }> {
    let count = 0;
    for (const fileRes of processedFiles) {
      for (const chunk of fileRes.chunks) {
        this.savedChunks.push({
          repositoryId,
          filePath: fileRes.file.relativePath,
          chunk,
        });
        count++;
      }
    }
    return { totalChunksInserted: count };
  }
}

async function testWorkflowExecution() {
  console.log('--- Testing Repository Ingestion Pipeline (module-level) ---');

  const mockProvider = new MockRepositoryProvider();
  const mockDb = new MockDatabaseLayer();

  // Directly invoke the underlying ingestion modules (mirrors what the workflow steps do)
  const acquiredRepo = await mockProvider.acquire('test-owner', 'test-repo');

  try {
    const { metadata, workspacePath } = acquiredRepo;

    // Step 1: file discovery + DB upsert
    const files = await discoverRepositoryFiles(workspacePath);
    const repositoryId = await mockDb.upsertRepository(metadata);

    // Step 2: parse + chunk + persist
    const parserManager = new TreeSitterParserManager();
    const batchProcessor = new BatchProcessor(parserManager, { batchSize: 2 });

    let processedFiles: ProcessedFileResult[];
    try {
      processedFiles = await batchProcessor.processFiles(files, (done, total) => {
        console.log(`  Processed ${done}/${total} files...`);
      });
    } finally {
      parserManager.dispose();
    }

    const { totalChunksInserted } = await mockDb.saveRepositoryChunks(repositoryId, processedFiles);
    const skippedFilesCount = processedFiles.filter((p) => p.error).length;

    const result = {
      totalFilesDiscovered: files.length,
      totalFilesProcessed: processedFiles.length - skippedFilesCount,
      totalChunksInserted,
      skippedFilesCount,
    };

    console.log('Pipeline Output Summary:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\nSaved Chunks Summary:');
    for (const item of mockDb.savedChunks) {
      console.log(`- File: ${item.filePath} | Type: ${item.chunk.chunkType} | Symbol: ${item.chunk.symbolName} | Lines: L${item.chunk.startLine}-L${item.chunk.endLine}`);
    }

    // Assertions
    if (result.totalFilesDiscovered !== 6) {
      throw new Error(`Expected 6 discovered files (src/index.ts, src/item.ts, src/helper.py, README.md, package.json, .github/workflows/ci.yml), got ${result.totalFilesDiscovered}`);
    }

    if (result.totalChunksInserted < 5) {
      throw new Error(`Expected at least 5 chunks inserted, got ${result.totalChunksInserted}`);
    }

    console.log('\n✅ All Pipeline Tests Passed Successfully!');
  } finally {
    await acquiredRepo.cleanup();
  }
}

testWorkflowExecution().catch((err) => {
  console.error('❌ Pipeline Test Failed:', err);
  process.exit(1);
});
