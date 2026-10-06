import type { RetrievedChunk } from "./retriever";

interface AssembledCitation {
  index: number;
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  text: string;
}

export interface AssembledContextResult {
  contextString: string;
  citations: AssembledCitation[];
  deduplicatedCount: number;
}

export interface ContextAssemblerOptions {
  maxTotalChars?: number;
  maxOverlapRatio?: number;
}

const DEFAULT_MAX_TOTAL_CHARS = 24000;
const DEFAULT_MAX_OVERLAP_RATIO = 0.6;

/**
 * Calculates line range overlap ratio between two chunks of the same file.
 */
function calculateLineOverlapRatio(
  a: { startLine: number; endLine: number },
  b: { startLine: number; endLine: number },
): number {
  const overlapStart = Math.max(a.startLine, b.startLine);
  const overlapEnd = Math.min(a.endLine, b.endLine);

  if (overlapStart > overlapEnd) {
    return 0;
  }

  const overlapLength = overlapEnd - overlapStart + 1;
  const aLength = a.endLine - a.startLine + 1;
  const bLength = b.endLine - b.startLine + 1;
  const minLength = Math.min(aLength, bLength);

  return minLength > 0 ? overlapLength / minLength : 0;
}

/**
 * Deduplicates candidate retrieved chunks by unique ID and overlapping line ranges.
 * Chunks from the same file with high overlap keep the higher ranked candidate.
 */
export function deduplicateRetrievedChunks(
  chunks: RetrievedChunk[],
  maxOverlapRatio = DEFAULT_MAX_OVERLAP_RATIO,
): RetrievedChunk[] {
  const seenIds = new Set<string>();
  const accepted: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    // 1. Exact ID deduplication
    if (seenIds.has(chunk.id)) {
      continue;
    }

    // 2. Overlapping line range deduplication within the same file
    const isSubsumedOrOverlapping = accepted.some((prev) => {
      if (prev.filePath !== chunk.filePath) {
        return false;
      }
      const overlap = calculateLineOverlapRatio(prev, chunk);
      return overlap >= maxOverlapRatio;
    });

    if (!isSubsumedOrOverlapping) {
      seenIds.add(chunk.id);
      accepted.push(chunk);
    }
  }

  return accepted;
}

/**
 * Assembles deduplicated chunks into a structured prompt context string with citations.
 */
export function assembleContext(
  chunks: RetrievedChunk[],
  options?: ContextAssemblerOptions,
): AssembledContextResult {
  const maxChars = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const maxOverlap = options?.maxOverlapRatio ?? DEFAULT_MAX_OVERLAP_RATIO;

  const deduplicated = deduplicateRetrievedChunks(chunks, maxOverlap);
  const deduplicatedCount = chunks.length - deduplicated.length;

  const citations: AssembledCitation[] = [];
  const contextParts: string[] = [];
  let currentTotalChars = 0;

  for (let i = 0; i < deduplicated.length; i++) {
    const chunk = deduplicated[i];
    const citationIndex = i + 1;

    const citation: AssembledCitation = {
      index: citationIndex,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      symbolName: chunk.symbolName ?? null,
      text: chunk.text,
    };

    const symbolTag = chunk.symbolName ? `, Symbol: ${chunk.symbolName}` : "";
    const block = `[Citation ${citationIndex}] File: ${chunk.filePath} (Lines: ${chunk.startLine}-${chunk.endLine}${symbolTag})\n\`\`\`${chunk.language || ""}\n${chunk.text}\n\`\`\``;

    if (currentTotalChars + block.length > maxChars && citations.length > 0) {
      break;
    }

    citations.push(citation);
    contextParts.push(block);
    currentTotalChars += block.length;
  }

  return {
    contextString: contextParts.join("\n\n"),
    citations,
    deduplicatedCount,
  };
}
