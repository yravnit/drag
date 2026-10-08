import { cn } from "@/lib/cn";

const SIZES = {
  sm: "size-7",
  md: "size-8",
  lg: "size-9",
} as const;

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: keyof typeof SIZES;
  /** Renders the pressed/active treatment. Use for toggles, not for one-shot actions. */
  active?: boolean;
}

export function IconButton({
  size = "md",
  active = false,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={active || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150",
        active
          ? "bg-accent-soft text-accent-ink"
          : "text-chat-ink-3 hover:bg-chat-3 hover:text-chat-ink",
        "disabled:pointer-events-none disabled:opacity-50",
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}