import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  label?: string;
}

export function Spinner({ label = "Loading", className, ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center gap-2 text-chat-ink-3", className)}
      {...props}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ? <span className="text-sm">{label}</span> : null}
    </span>
  );
}