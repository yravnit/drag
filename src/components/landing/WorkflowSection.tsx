import { Fragment } from "react";
import { WorkflowStepRow } from "./WorkflowStepRow";
import { ConnectVisual } from "./visuals/ConnectVisual";
import { ExploreVisual } from "./visuals/ExploreVisual";
import { IndexVisual } from "./visuals/IndexVisual";
import { VerifySyncVisual } from "./visuals/VerifySyncVisual";
import { PAGE_CONTAINER } from "./constants";

const PROGRESSION_STEPS = [
  { num: "01", label: "Connect" },
  { num: "02", label: "Understand" },
  { num: "03", label: "Explore" },
  { num: "04", label: "Verify & Stay Current" },
];

export function WorkflowSection() {
  return (
    <section id="how-it-works" className="bg-page transition-colors duration-200 ease-out">
      <div className={`${PAGE_CONTAINER} pt-24 pb-30`}>
        <div className="mx-auto max-w-[840px] text-center">
          <h2 className="font-display text-[clamp(2.2rem,4.5vw,3.25rem)] font-semibold leading-[1.08] tracking-display text-ink">
            Understand a codebase in minutes, not hours.
          </h2>
        </div>

        <div className="mt-12 mb-16 flex flex-wrap items-center justify-center gap-x-[clamp(12px,3.5vw,40px)] gap-y-3 py-3">
          {PROGRESSION_STEPS.map((step, index) => (
            <Fragment key={step.num}>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[15px] font-bold tracking-[-0.02em] text-ink">
                  {step.num}
                </span>
                <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink-3">
                  {step.label}
                </span>
              </div>
              {index < PROGRESSION_STEPS.length - 1 && (
                <span aria-hidden className="select-none text-[13px] text-ink-4">
                  →
                </span>
              )}
            </Fragment>
          ))}
        </div>

        <div className="flex flex-col gap-18">
          <WorkflowStepRow
            eyebrow="Connect"
            title="Connect your repository with zero friction"
            description="Sign in with GitHub and choose the repository you want to explore. DRAG securely connects using your existing repository access permissions, with no personal access tokens or complex configurations to manage."
            visual={<ConnectVisual />}
            reversed={false}
          />
          <WorkflowStepRow
            eyebrow="Understand"
            title="Parse syntax & generate deep embeddings"
            description="DRAG parses your code into syntax-aware chunks and builds a searchable semantic index of the implementation. Functions, classes, types, and related code stay connected instead of being treated as isolated text."
            visual={<IndexVisual />}
            reversed
          />
          <WorkflowStepRow
            eyebrow="Explore"
            title="Ask about the codebase and get grounded answers"
            description="Ask questions in natural language. DRAG retrieves the most relevant implementation chunks through hybrid semantic and keyword search, then generates precise answers strictly grounded in the code."
            visual={<ExploreVisual />}
            reversed={false}
          />
          <WorkflowStepRow
            eyebrow="Verify & Stay Current"
            title="Verify against the source while the index stays up to date"
            description="Every response provides interactive citations pointing to the exact file, symbol, and line range. When the repository changes, paid plans re-index only the modified files in milliseconds."
            visual={<VerifySyncVisual />}
            reversed
          />
        </div>
      </div>
    </section>
  );
}
