import { buildBenchmarkCorpus } from "./benchmarkCorpus";
import { searchHybridBenchmark } from "./runEval";
import { TreeSitterParserManager } from "../../ingestion/parserManager";
import { BatchProcessor } from "../../ingestion/batchProcessor";
import { DiscoveredFile } from "../../ingestion/fileFilter";
import fs from "fs";
import path from "path";
import os from "os";

interface LatencyStats {
  concurrency: number;
  totalRequests: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  throughputReqPerSec: number;
}

function calculatePercentiles(latencies: number[]): {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
} {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { p50, p95, p99, avg, min, max };
}

/**
 * 1. Benchmark concurrent hybrid retrieval operations
 *
 * ponytail: ranks an in-memory RRF pass over a synthetic corpus, so these latencies
 * measure ranking cost only — not pgvector, network, or Postgres. Useful as a
 * regression guard on the fusion math; useless as a database capacity number. Upgrade
 * path: a variant that runs the same queries through the real retriever against Neon
 * when DATABASE_URL is live, kept out of CI so the suite stays offline.
 */
export async function benchmarkConcurrentRetrieval(
  concurrencyLevels: number[] = [1, 5, 10, 20],
): Promise<LatencyStats[]> {
  const corpus = buildBenchmarkCorpus();
  const queries = [
    "verifyRepositoryAccess",
    "claimSyncBatch",
    "sanitizeMermaid",
    "checkRateLimit",
    "assembleContext",
    "discoverRepositoryFiles",
    "EMBEDDING_DIMENSIONS",
    "handleRetryMessage",
    "TreeSitterParserManager",
    "answerConversation",
  ];

  const results: LatencyStats[] = [];

  for (const concurrency of concurrencyLevels) {
    const latencies: number[] = [];
    const totalRequests = concurrency * 5; // 5 rounds per worker

    const startTime = performance.now();

    // Run batches of size `concurrency`
    for (let r = 0; r < 5; r++) {
      const batchPromises = Array.from({ length: concurrency }, async (_, i) => {
        const query = queries[(r * concurrency + i) % queries.length];
        const reqStart = performance.now();
        searchHybridBenchmark(corpus, query, 8);
        const reqEnd = performance.now();
        latencies.push(reqEnd - reqStart);
      });
      await Promise.all(batchPromises);
    }

    const totalDurationSec = (performance.now() - startTime) / 1000;
    const { p50, p95, p99, avg, min, max } = calculatePercentiles(latencies);

    results.push({
      concurrency,
      totalRequests,
      p50Ms: Math.round(p50 * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      p99Ms: Math.round(p99 * 100) / 100,
      avgMs: Math.round(avg * 100) / 100,
      minMs: Math.round(min * 100) / 100,
      maxMs: Math.round(max * 100) / 100,
      throughputReqPerSec: Math.round((totalRequests / totalDurationSec) * 10) / 10,
    });
  }

  return results;
}

/**
 * 2. Benchmark ingestion parsing & batching throughput and memory footprint
 */
export async function benchmarkIngestionThroughput(): Promise<{
  filesProcessed: number;
  chunksGenerated: number;
  durationMs: number;
  throughputChunksPerSec: number;
  memoryDeltaMb: number;
}> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "drag-load-ingest-"));
  const parserManager = new TreeSitterParserManager();
  const batchProcessor = new BatchProcessor(parserManager, { batchSize: 5 });

  const files: DiscoveredFile[] = [];

  try {
    // Generate 20 synthetic realistic TypeScript source files
    for (let i = 0; i < 20; i++) {
      const filePath = path.join(tempDir, `service_${i}.ts`);
      const content = `
import { Database } from "@/db/db";

export interface Item_${i} {
  id: string;
  name: string;
  score: number;
}

export class Service_${i} {
  constructor(private db: Database) {}

  public async getItem(id: string): Promise<Item_${i} | null> {
    return { id, name: "Item " + id, score: ${i} };
  }

  public async updateItem(id: string, name: string): Promise<void> {
    // Update implementation
  }
}

export function helperFunction_${i}(input: string): string {
  return "prefix_" + input;
}
      `.trim();

      await fs.promises.writeFile(filePath, content, "utf-8");
      files.push({
        relativePath: `src/services/service_${i}.ts`,
        absolutePath: filePath,
        category: "source",
        language: "typescript",
      });
    }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    const processed = await batchProcessor.processFiles(files);
    const durationMs = performance.now() - start;
    const memAfter = process.memoryUsage().heapUsed;

    const totalChunks = processed.reduce((sum, p) => sum + p.chunks.length, 0);
    const memoryDeltaMb = Math.round(((memAfter - memBefore) / (1024 * 1024)) * 100) / 100;

    return {
      filesProcessed: files.length,
      chunksGenerated: totalChunks,
      durationMs: Math.round(durationMs),
      throughputChunksPerSec: Math.round((totalChunks / (durationMs / 1000)) * 10) / 10,
      memoryDeltaMb,
    };
  } finally {
    parserManager.dispose();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

export function formatLoadReport(
  retrievalStats: LatencyStats[],
  ingestionStats: {
    filesProcessed: number;
    chunksGenerated: number;
    durationMs: number;
    throughputChunksPerSec: number;
    memoryDeltaMb: number;
  },
): string {
  const lines: string[] = [];

  lines.push("============================================================");
  lines.push(" DRAG Production Readiness: Concurrency & Load Benchmark");
  lines.push("============================================================");
  lines.push("");
  lines.push("[1] HYBRID RETRIEVAL CONCURRENCY BENCHMARK (in-memory RRF, no database)");
  lines.push("------------------------------------------------------------");
  lines.push(
    " Concurrency | Requests | P50 (ms) | P95 (ms) | P99 (ms) | Avg (ms) | Throughput (req/s)",
  );
  lines.push(
    "-------------|----------|----------|----------|----------|----------|-------------------",
  );

  for (const s of retrievalStats) {
    const conc = String(s.concurrency).padStart(11, " ");
    const reqs = String(s.totalRequests).padStart(8, " ");
    const p50 = s.p50Ms.toFixed(2).padStart(8, " ");
    const p95 = s.p95Ms.toFixed(2).padStart(8, " ");
    const p99 = s.p99Ms.toFixed(2).padStart(8, " ");
    const avg = s.avgMs.toFixed(2).padStart(8, " ");
    const tps = s.throughputReqPerSec.toFixed(1).padStart(17, " ");
    lines.push(`${conc} | ${reqs} | ${p50} | ${p95} | ${p99} | ${avg} | ${tps}`);
  }

  lines.push("");
  lines.push("[2] INGESTION & PARSER PIPELINE BENCHMARK");
  lines.push("------------------------------------------------------------");
  lines.push(` Files processed:     ${ingestionStats.filesProcessed}`);
  lines.push(` Chunks generated:    ${ingestionStats.chunksGenerated}`);
  lines.push(` Duration:            ${ingestionStats.durationMs} ms`);
  lines.push(` Throughput:          ${ingestionStats.throughputChunksPerSec} chunks/sec`);
  lines.push(` Heap memory delta:   ${ingestionStats.memoryDeltaMb} MB`);
  lines.push("");
  lines.push("[3] SCOPE OF THESE NUMBERS");
  lines.push("------------------------------------------------------------");
  lines.push(" Measured above:  in-memory RRF ranking latency and local parser throughput.");
  lines.push(
    " Not measured:    model streaming latency, database/vector-store capacity, or the",
  );
  lines.push(
    "                  repository size/file-count limits enforced by the API routes.",
  );
  lines.push(
    " Configured elsewhere: chat rate limit 30 req/min/user, ingest 5 req/hr/user,",
  );
  lines.push("                  both persisted in Postgres (see rateLimiter.ts).");
  lines.push("============================================================");

  return lines.join("\n");
}

export async function runLoadBenchmark() {
  console.log("Running DRAG production load and concurrency benchmark...");
  const retrievalStats = await benchmarkConcurrentRetrieval([1, 5, 10, 20]);
  const ingestionStats = await benchmarkIngestionThroughput();
  console.log("\n" + formatLoadReport(retrievalStats, ingestionStats));
}

if (process.argv[1] && process.argv[1].includes("runLoadTest")) {
  runLoadBenchmark().catch(console.error);
}
