import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { TechWindow } from "./TechWindow";
import { PAGE_CONTAINER, PRIMARY_CTA } from "./constants";

const CITATIONS = [
  { marker: "[1]", path: "src/lib/retrieval/retriever.ts:L202" },
  { marker: "[2]", path: "src/lib/retrieval/fusion.ts:L18" },
];

const CODE_CHIP = "rounded-[4px] bg-[#3e3d32] px-1.5 py-0.5 font-mono text-xs text-[#a6e22e]";

const MARKER_CHIP =
  "inline-flex size-[17px] items-center justify-center rounded-[4px] border border-[rgba(174,129,255,0.4)] bg-[#3e3d32] text-[10px] font-bold text-[#ae81ff]";

const SOURCE_CHIP =
  "flex items-center gap-1.5 rounded-[6px] border border-[#3e3d32] bg-[#1e1f1c] px-2.5 py-1 text-[#66d9ef]";

export function HeroSection() {
  return (
    <section id="home-hero" className="relative overflow-hidden bg-hero pt-8">
      <div
        className={`${PAGE_CONTAINER} grid items-center gap-12 pt-12 pb-22 lg:grid-cols-[minmax(0,500fr)_minmax(0,750fr)]`}
      >
        <div>
          <h1 className="font-display text-[clamp(2.8rem,5.5vw,4.1rem)] font-semibold leading-[1.04] tracking-display text-ink">
            Your guide to an unfamiliar codebase.
          </h1>

          <p className="mt-6 max-w-[480px] text-lg leading-[28px] font-medium tracking-[-0.02em] text-ink-2">
            DRAG connects to your GitHub repositories, builds a semantic index of the code, and
            retrieves the most relevant implementation when you ask a question. Every answer is
            grounded in cited source.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-[18px]">
            <Link href="/workspace" className={`${PRIMARY_CTA} px-[26px] py-[13px] text-base`}>
              <span>Start now</span>
              <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        </div>

        <div className="w-full">
          <TechWindow title="drag-preview — yravnit/drag">
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2 rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-3.5 py-2.5 font-mono text-[12.5px] text-[#66d9ef]">
                <Search size={14} className="shrink-0 text-[#66d9ef]" aria-hidden />
                <span>How does the retriever rank chunks for a question?</span>
              </div>

              <div className="rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-4 py-3.5 text-left text-[13.5px] leading-[1.7] text-code-fg">
                Ranking runs two passes — pgvector cosine similarity and a PostgreSQL full-text scan
                — then <code className={CODE_CHIP}>retrieveChunks()</code> merges them with reciprocal
                rank fusion <span className={MARKER_CHIP}>1</span>. The fused{" "}
                <code className={CODE_CHIP}>fuseHybridResults()</code> ranking is what reaches the
                model <span className={MARKER_CHIP}>2</span>.
              </div>

              <div className="flex flex-wrap gap-2 border-t border-[#3e3d32] pt-2.5 font-mono text-[11px]">
                {CITATIONS.map((citation) => (
                  <div key={citation.path} className={SOURCE_CHIP}>
                    <span className="font-bold text-[#ae81ff]">{citation.marker}</span>
                    {citation.path}
                  </div>
                ))}
              </div>
            </div>
          </TechWindow>
        </div>
      </div>
    </section>
  );
}
