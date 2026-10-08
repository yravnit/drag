import { TechWindow } from "../TechWindow";

const RETRIEVED_CHUNKS = [
  {
    tag: "[1]",
    file: "src/lib/retrieval/retriever.ts",
    symbol: "retrieveChunks",
    score: "0.94",
  },
  { tag: "[2]", file: "src/lib/retrieval/fusion.ts", symbol: "fuseHybridResults", score: "0.89" },
];

const MARKER_CHIP =
  "inline-flex size-4 items-center justify-center rounded-[3px] border border-[rgba(174,129,255,0.4)] bg-[#3e3d32] text-[9.5px] font-bold text-[#ae81ff]";

export function ExploreVisual() {
  return (
    <TechWindow title="drag-explore — query, retrieval & grounded answer">
      <div className="flex flex-col gap-3 text-left font-mono text-xs leading-[1.6] text-code-fg">
        <div className="rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-3.5 py-2.5">
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="text-[#75715e] italic">{"// 1. Hybrid retrieval"}</span>
            <span className="rounded-[4px] bg-[rgba(102,217,239,0.12)] px-1.5 py-px text-[10.5px] text-[#66d9ef]">
              pgvector + FTS · topK: 5
            </span>
          </div>

          <div className="mb-2 flex items-center gap-2 text-[12px] text-[#e6db74]">
            <span className="font-bold text-[#f92672]">&gt;</span>
            <span>&ldquo;How does a question become ranked code chunks?&rdquo;</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {RETRIEVED_CHUNKS.map((chunk) => (
              <div
                key={chunk.file}
                className="flex items-center justify-between rounded-[5px] border border-[#3e3d32] bg-[#272822] px-2.5 py-1 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[#ae81ff]">{chunk.tag}</span>
                  <span className="text-[#66d9ef]">{chunk.file}</span>
                  <span className="text-[#75715e]">{chunk.symbol}()</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#75715e]">match</span>
                  <span className="font-semibold text-[#a6e22e]">{chunk.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-3.5 py-3">
          <div className="text-[12.5px] leading-[1.65] font-sans text-code-fg">
            A question is embedded and also matched against PostgreSQL full text, then both rankings
            are merged with reciprocal rank fusion <span className={MARKER_CHIP}>1</span>. Only the
            top chunks belonging to that one repository are ever handed to the model{" "}
            <span className={MARKER_CHIP}>2</span>.
          </div>
        </div>
      </div>
    </TechWindow>
  );
}
