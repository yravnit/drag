import { E2E_RAG_EVAL_DATASET, HELD_OUT_E2E_DATASET } from "./e2eDataset";
import { evaluateE2ERag, formatE2EReport, type E2EEvalSummary } from "./e2eEvaluator";
import { buildBenchmarkCorpus } from "./benchmarkCorpus";
import { searchHybridBenchmark } from "./runEval";
import type { RetrievedChunk } from "../retriever";

const STOP_WORDS = new Set([
  "what", "where", "how", "the", "and", "for", "with", "does", "when", "during",
  "are", "from", "into", "this", "that", "which", "used", "use", "uses",
]);

/** Query terms a chunk can be checked against, without consulting the answer key. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Deterministic stand-in for answer generation, for offline/CI use.
 *
 * Reads ONLY the query and the retrieved chunks. It must not consult `requiredFacts` or
 * `evidenceType`: the evaluator checks those facts against the answer, so seeding them into the
 * answer made every case pass by construction and the benchmark measured nothing about the
 * prompt, the model, or the retriever. It also means these numbers say nothing about prompt or
 * model quality — they are a retrieval and evaluator self-consistency check only.
 */
export function generateDeterministicRagResponse(
  query: string,
  retrievedChunks: RetrievedChunk[],
): string {
  const terms = queryTerms(query);

  // Grounding decided from the retrieved text, not from the case's declared evidence type.
  const grounded = retrievedChunks
    .map((chunk, i) => ({ chunk, index: i + 1 }))
    .filter(({ chunk }) => {
      const haystack = `${chunk.filePath} ${chunk.symbolName ?? ""} ${chunk.text}`.toLowerCase();
      return terms.some((t) => haystack.includes(t));
    })
    .slice(0, 3);

  if (grounded.length === 0) {
    return "I cannot determine this from the indexed repository. No retrieved chunk mentions the queried behaviour.";
  }

  const citations = grounded.map(({ index }) => `[${index}]`).join(", ");
  const evidence = grounded
    .map(({ chunk, index }) => {
      const where = chunk.symbolName
        ? `${chunk.filePath} (${chunk.symbolName})`
        : chunk.filePath;
      const snippet = chunk.text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
      return `${where} [${index}]: ${snippet}`;
    })
    .join(" ");

  return `Based on the retrieved code, ${evidence} Sources: ${citations}.`;
}

export function runE2EBenchmark(): {
  mainSummary: E2EEvalSummary;
  heldOutSummary: E2EEvalSummary;
} {
  const corpus = buildBenchmarkCorpus();
  console.log(`Loaded benchmark corpus: ${corpus.length} chunks from DRAG repository.`);

  // 1. Run Curated Main Benchmark (37 cases)
  console.log(`Running End-to-End RAG evaluation on ${E2E_RAG_EVAL_DATASET.length} curated cases...`);
  const retrievalMap = new Map<string, RetrievedChunk[]>();
  const answerMap = new Map<string, string>();

  for (const c of E2E_RAG_EVAL_DATASET) {
    const retrieved = searchHybridBenchmark(corpus, c.query, 8);
    retrievalMap.set(c.id, retrieved);

    const answer = generateDeterministicRagResponse(c.query, retrieved);
    answerMap.set(c.id, answer);
  }

  const mainSummary = evaluateE2ERag(E2E_RAG_EVAL_DATASET, retrievalMap, answerMap);
  console.log("\n" + formatE2EReport(mainSummary));

  // 2. Run Held-Out Evaluation (5 cases) to detect overfitting
  console.log(`\nRunning Held-Out Evaluation on ${HELD_OUT_E2E_DATASET.length} un-tuned cases...`);
  const heldOutRetrievalMap = new Map<string, RetrievedChunk[]>();
  const heldOutAnswerMap = new Map<string, string>();

  for (const c of HELD_OUT_E2E_DATASET) {
    const retrieved = searchHybridBenchmark(corpus, c.query, 8);
    heldOutRetrievalMap.set(c.id, retrieved);

    const answer = generateDeterministicRagResponse(c.query, retrieved);
    heldOutAnswerMap.set(c.id, answer);
  }

  const heldOutSummary = evaluateE2ERag(HELD_OUT_E2E_DATASET, heldOutRetrievalMap, heldOutAnswerMap);
  console.log("\n" + formatE2EReport(heldOutSummary));

  console.log("\n[What These Numbers Measure]");
  console.log(
    "Answers are generated deterministically from the retrieved chunks, with no access to the\n" +
    "expected facts, so these scores measure retrieval quality and whether the evaluator agrees\n" +
    "with grounded code. They say nothing about the chat system prompt or the LLM: a live-model\n" +
    "run is required for that. Real-world accuracy additionally depends on model reasoning,\n" +
    "repository complexity, and coverage of external libraries.",
  );

  return { mainSummary, heldOutSummary };
}

if (process.argv[1] && process.argv[1].includes("runE2eEval")) {
  runE2EBenchmark();
}
