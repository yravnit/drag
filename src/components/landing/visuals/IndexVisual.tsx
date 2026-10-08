import { TechWindow } from "../TechWindow";

const INDEX_STEPS = [
  "8,391 syntax chunks",
  "768-dim embeddings",
  "pgvector HNSW index",
  "AST symbol boundaries",
];

export function IndexVisual() {
  return (
    <TechWindow title="drag-core — parse & vector-embed">
      <div className="text-left font-mono text-xs leading-[1.65] text-code-fg">
        <div className="rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-4 py-3.5">
          <div className="mb-1.5 flex justify-between text-[11px]">
            <span className="font-semibold text-[#66d9ef]">AST Chunking &amp; Tokenization</span>
            <span className="font-semibold text-[#ae81ff]">1,204 / 1,204 files</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-[3px] bg-[#3e3d32]">
            <div className="h-full w-full bg-[#a6e22e]" />
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            {INDEX_STEPS.map((step) => (
              <div key={step} className="flex items-center gap-1.5 text-code-fg">
                <span className="font-bold text-[#a6e22e]">✓</span> {step}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 text-[11px] text-[#75715e] italic">
          {"// Indexed in 4.2s · Ready for sub-second semantic retrieval"}
        </div>
      </div>
    </TechWindow>
  );
}
