import { ContributorIllustration } from "./illustrations/ContributorIllustration";
import { ProfessionalIllustration } from "./illustrations/ProfessionalIllustration";
import { StudentIllustration } from "./illustrations/StudentIllustration";
import { PAGE_CONTAINER } from "./constants";

const USE_CASES = [
  {
    title: "Students learning new codebases",
    illustration: <StudentIllustration />,
    description: "Learn how real production architectures are structured, without getting lost in thousands of files.",
  },
  {
    title: "Contributing to open source",
    illustration: <ContributorIllustration />,
    description:
      "Find where your contribution belongs. Locate entry points, provider interfaces, and test suites without guesswork.",
  },
  {
    title: "New recruits onboarding company",
    illustration: <ProfessionalIllustration />,
    description: "Get productive on day one. Understand service boundaries, legacy flows, and auth systems fast.",
  },
];

export function UseCaseSection() {
  return (
    <section
      id="use-cases"
      className="border-b border-line bg-page-2 transition-colors duration-200 ease-out"
    >
      <div className={`${PAGE_CONTAINER} pt-22 pb-24`}>
        <div className="mx-auto mb-14 max-w-[760px] text-center">
          <h2 className="font-display text-[clamp(2.1rem,4vw,3rem)] font-semibold leading-[1.1] tracking-display text-ink">
            Start where the questions begin.
          </h2>
        </div>

        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((useCase) => (
            <div
              key={useCase.title}
              className="flex flex-col gap-4.5 rounded-card border border-line bg-surface px-[22px] pt-6 pb-7 transition-colors duration-200 ease-out"
            >
              <div className="overflow-hidden rounded-[10px] border border-line bg-surface-2">
                {useCase.illustration}
              </div>

              <div>
                <h3 className="font-display text-xl font-semibold leading-[1.25] tracking-display text-ink">
                  {useCase.title}
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-[1.6] text-ink-3">
                  {useCase.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
