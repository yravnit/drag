export interface WorkflowStep {
  eyebrow: string;
  title: string;
  description: string;
  visual: React.ReactNode;
  reversed: boolean;
}

export function WorkflowStepRow({ eyebrow, title, description, visual, reversed }: WorkflowStep) {
  return (
    <div className="grid items-center gap-[clamp(32px,5vw,64px)] max-lg:grid-cols-1 max-lg:gap-9 lg:grid-cols-2">
      <div className={reversed ? "lg:order-2" : undefined}>
        <div className="mb-[18px] inline-flex items-center rounded-chip border border-line bg-surface-2 px-3.5 py-[5px]">
          <span className="text-[11.5px] font-bold tracking-[0.06em] text-accent uppercase">
            {eyebrow}
          </span>
        </div>

        <h3 className="font-display text-[clamp(1.7rem,2.7vw,2.25rem)] font-semibold leading-[1.15] tracking-display text-ink">
          {title}
        </h3>

        <p className="mt-[18px] text-[16.5px] leading-[1.75] font-medium tracking-[-0.015em] text-ink-2">
          {description}
        </p>
      </div>

      <div className={reversed ? "w-full lg:order-1" : "w-full"}>{visual}</div>
    </div>
  );
}
