import { PAGE_CONTAINER } from "./constants";

export function CtaSection() {
  return (
    <section className="border-t border-line bg-cta pt-28 pb-32 text-center transition-colors duration-200 ease-out">
      <div className={PAGE_CONTAINER}>
        <h2 className="mx-auto max-w-[700px] font-display text-[clamp(2.2rem,4.5vw,3.25rem)] font-semibold tracking-display text-ink">
          Stop guessing. Start citing.
        </h2>
        <p className="mx-auto mt-4 max-w-[520px] text-[17px] leading-[28px] font-medium text-ink-3">
          Connect your GitHub repository and start asking real questions over your codebase in under
          five minutes.
        </p>
      </div>
    </section>
  );
}
