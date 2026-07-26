import fs from 'fs';
import crypto from 'crypto';
import { DiscoveredFile } from './fileFilter';
import { TreeSitterParserManager } from './parserManager';
import { SemanticChunker, RawChunk } from './semanticChunker';

export interface ProcessedFileResult {
  file: DiscoveredFile;
  chunks: RawChunk[];
  contentHash: string;
  sizeBytes: number;
  error?: string;
}

export interface BatchProcessorOptions {
  batchSize?: number; // Concurrency limit per batch
}

export class BatchProcessor {
  private chunker: SemanticChunker;
  private batchSize: number;

  constructor(parserManager: TreeSitterParserManager, options?: BatchProcessorOptions) {
    this.chunker = new SemanticChunker(parserManager);
    this.batchSize = options?.batchSize || 10;
  }

  /**
   * Helper to compute SHA-256 content hash of file text.
   */
  public static computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Processes files in bounded batches.
   * Uses isolated per-task Tree-sitter parsers guarantees zero parser leaks and thread safety under Promise.all.
   * Computes per-file content hash for robust incremental tracking.
   * Skips individual file errors and continues processing remaining files.
   */
  public async processFiles(
    files: DiscoveredFile[],
    onProgress?: (processedCount: number, totalCount: number) => void
  ): Promise<ProcessedFileResult[]> {
    const results: ProcessedFileResult[] = [];
    let processedCount = 0;

    for (let i = 0; i < files.length; i += this.batchSize) {
      const batch = files.slice(i, i + this.batchSize);

      const batchPromises = batch.map(async (file): Promise<ProcessedFileResult> => {
        try {
          const content = await fs.promises.readFile(file.absolutePath, 'utf-8');
          const contentHash = BatchProcessor.computeContentHash(content);
          const sizeBytes = Buffer.byteLength(content, 'utf-8');
          const chunks = await this.chunker.chunkFile(file, content);

          return {
            file,
            chunks,
            contentHash,
            sizeBytes,
          };
        } catch (error) {
          console.error(`Skipping file due to parsing/reading error: ${file.relativePath}`, error);
          return {
            file,
            chunks: [],
            contentHash: '',
            sizeBytes: 0,
            error: (error as Error).message || String(error),
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      processedCount += batch.length;

      if (onProgress) {
        onProgress(processedCount, files.length);
      }
    }

    return results;
  }
}
