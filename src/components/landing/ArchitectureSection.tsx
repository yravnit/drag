import { MermaidVisual } from "./visuals/MermaidVisual";
import { PAGE_CONTAINER } from "./constants";

const EXAMPLE_QUESTIONS = [
  "“Show me how a request flows from the API to the database.”",
  "“How do the authentication services interact?”",
];

export function ArchitectureSection() {
  return (
    <section
      id="architecture-diagrams"
      className="border-t border-b border-line bg-arch transition-colors duration-200 ease-out"
    >
      <div className={`${PAGE_CONTAINER} py-24`}>
        <div className="grid items-center gap-[clamp(32px,5vw,64px)] max-lg:grid-cols-1 max-lg:gap-9 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.15fr)]">
          <div>
            <h2 className="font-display text-[clamp(2.2rem,3.8vw,2.9rem)] font-semibold leading-[1.12] tracking-display text-ink">
              See how the codebase fits together.
            </h2>

            <p className="mt-[18px] text-[17px] leading-[1.6] font-bold text-ink">
              Ask DRAG to turn unfamiliar code into a visual map of the system.
            </p>

            <p className="mt-3 text-[15.5px] leading-[1.7] font-medium text-ink-3">
              DRAG analyzes the relevant code and generates a Mermaid diagram that you can inspect
              directly alongside the answer.
            </p>

            <div className="mt-[22px]">
              <p className="mb-2.5 text-[13px] font-bold tracking-[0.05em] text-ink-4 uppercase">
                Ask questions like:
              </p>
              <div className="flex flex-col gap-2">
                {EXAMPLE_QUESTIONS.map((question) => (
                  <div
                    key={question}
                    className="rounded-[8px] border border-line border-l-[3px] border-l-accent bg-surface px-3.5 py-2.5 text-sm font-semibold text-ink italic shadow-card"
                  >
                    {question}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <MermaidVisual />
          </div>
        </div>
      </div>
    </section>
  );
}
