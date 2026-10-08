import fs from "fs";
import path from "path";
import type { RetrievedChunk } from "../retriever";

export interface BenchmarkChunk extends RetrievedChunk {
  embeddingVector: number[];
}

/**
 * Deterministic hash-based 128-dimensional embedding projector.
 * Generates reproducible unit vectors where token overlap and semantic n-grams
 * yield realistic cosine similarity distributions (0.2 to 0.95).
 */
export function computeDeterministicEmbedding(text: string, dimensions = 128): number[] {
  const vec = Array.from({ length: dimensions }, () => 0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9_]/g, " ");
  const tokens = normalized.split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let h = 0x811c9dc5;
    for (let c = 0; c < token.length; c++) {
      h ^= token.charCodeAt(c);
      h = Math.imul(h, 0x01000193);
    }
    const idx = Math.abs(h) % dimensions;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign * (1 + 1 / (token.length + 1));

    // Bigram context
    if (i < tokens.length - 1) {
      const bigram = token + "_" + tokens[i + 1];
      let bh = 0x811c9dc5;
      for (let bc = 0; bc < bigram.length; bc++) {
        bh ^= bigram.charCodeAt(bc);
        bh = Math.imul(bh, 0x01000193);
      }
      const bIdx = Math.abs(bh) % dimensions;
      vec[bIdx] += 1.5;
    }
  }

  // Normalize to unit vector
  let norm = 0;
  for (let d = 0; d < dimensions; d++) {
    norm += vec[d] * vec[d];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let d = 0; d < dimensions; d++) {
      vec[d] /= norm;
    }
  }

  return vec;
}

/**
 * Builds representative benchmark chunks from the DRAG codebase on disk.
 */
export function buildBenchmarkCorpus(projectRoot = process.cwd()): BenchmarkChunk[] {
  const targetFiles = [
    "src/lib/ingestion/fileFilter.ts",
    "src/lib/ingestion/semanticChunker.ts",
    "src/lib/ingestion/parserManager.ts",
    "src/lib/ingestion/dbLayer.ts",
    "src/lib/leases/repositoryLeases.ts",
    "src/lib/rateLimit/rateLimiter.ts",
    "src/lib/mermaid/sanitizeMermaid.ts",
    "src/lib/embeddings/embeddingProvider.ts",
    "src/lib/embeddings/router.ts",
    "src/lib/embeddings/geminiEmbeddingProvider.ts",
    "src/lib/embeddings/cloudflareEmbeddingProvider.ts",
    "src/lib/llm/llmProvider.ts",
    "src/lib/retrieval/retriever.ts",
    "src/lib/chat/conversation.ts",
    "src/lib/access/repositoryAccess.ts",
    "src/lib/retrieval/contextAssembler.ts",
    "src/lib/observability/logger.ts",
    "src/lib/cron/cronAuth.ts",
    "src/app/api/repos/route.ts",
    "src/app/api/chat/route.ts",
    "src/app/api/cron/sync/route.ts",
    "src/app/api/conversations/[id]/route.ts",
    "src/app/components/workspace/CitationDrawer.tsx",
    "src/app/components/workspace/MessageRenderer.tsx",
    "src/workflows/embed.ts",
    "src/workflows/sync.ts",
    "src/workflows/ingest.ts",
    "src/lib/ingestion/githubApiClient.ts",
    "src/data/serverEnv.ts",
    "src/data/clientEnv.ts",
    "src/db/schemas/chunks.ts",
    "src/db/schemas/repository.ts",
  ];

  const chunksList: BenchmarkChunk[] = [];
  let chunkCounter = 1;

  for (const relPath of targetFiles) {
    const fullPath = path.resolve(projectRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");

    // Extract top-level functions and classes by scanning lines
    let currentChunkStart = 1;
    let currentSymbol: string | null = null;
    let currentType = "statement_block";
    let chunkLines: string[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/);
      const classMatch = line.match(/(?:export\s+)?class\s+([a-zA-Z0-9_]+)/);
      const constMatch = line.match(/export\s+const\s+([a-zA-Z0-9_]+)/);

      if (fnMatch || classMatch || constMatch) {
        // Flush previous chunk if non-empty
        if (chunkLines.length > 5) {
          const text = chunkLines.join("\n");
          chunksList.push({
            id: `bench-chunk-${chunkCounter++}`,
            repositoryId: "drag-repo-id",
            filePath: relPath.replace(/\\/g, "/"),
            language: "typescript",
            chunkType: currentType,
            symbolName: currentSymbol,
            startLine: currentChunkStart,
            endLine: lineIdx,
            text,
            similarity: 0,
            embeddingVector: computeDeterministicEmbedding(text),
          });
        }
        currentChunkStart = lineIdx + 1;
        chunkLines = [line];
        if (fnMatch) {
          currentSymbol = fnMatch[1];
          currentType = "function_item";
        } else if (classMatch) {
          currentSymbol = classMatch[1];
          currentType = "class_item";
        } else if (constMatch) {
          currentSymbol = constMatch[1];
          currentType = "variable_declaration";
        }
      } else {
        chunkLines.push(line);
        // Split oversized chunks
        if (chunkLines.length >= 60) {
          const text = chunkLines.join("\n");
          chunksList.push({
            id: `bench-chunk-${chunkCounter++}`,
            repositoryId: "drag-repo-id",
            filePath: relPath.replace(/\\/g, "/"),
            language: "typescript",
            chunkType: currentType,
            symbolName: currentSymbol,
            startLine: currentChunkStart,
            endLine: lineIdx + 1,
            text,
            similarity: 0,
            embeddingVector: computeDeterministicEmbedding(text),
          });
          currentChunkStart = lineIdx + 2;
          chunkLines = [];
          currentSymbol = null;
          currentType = "statement_block";
        }
      }
    }

    if (chunkLines.length > 0) {
      const text = chunkLines.join("\n");
      chunksList.push({
        id: `bench-chunk-${chunkCounter++}`,
        repositoryId: "drag-repo-id",
        filePath: relPath.replace(/\\/g, "/"),
        language: "typescript",
        chunkType: currentType,
        symbolName: currentSymbol,
        startLine: currentChunkStart,
        endLine: lines.length,
        text,
        similarity: 0,
        embeddingVector: computeDeterministicEmbedding(text),
      });
    }
  }

  return chunksList;
}
