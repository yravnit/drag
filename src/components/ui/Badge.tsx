import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "ok" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-3 border-line",
  accent: "bg-accent-soft text-accent-ink border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[9999px] border px-2 py-0.5",
        "text-[11px] leading-4 font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}