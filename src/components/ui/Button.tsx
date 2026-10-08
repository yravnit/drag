import { cn } from "@/lib/cn";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-btn text-btn-fg shadow-[0_4px_14px_rgba(0,0,0,0.16)] hover:bg-btn-hover hover:shadow-[0_6px_20px_rgba(0,0,0,0.22)] active:shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
  outline:
    "bg-btn-o text-btn-o-fg border border-btn-o-line hover:bg-btn-o-hover hover:border-line-2",
  ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[6px] font-semibold whitespace-nowrap",
        "transition-[background-color,border-color,color,box-shadow] duration-150 ease-out",
        "active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}