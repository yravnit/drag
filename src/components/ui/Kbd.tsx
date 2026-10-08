"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Platform-aware shortcut badge. `navigator.platform` is deprecated and the modern
 * `userAgentData` is Chromium-only, so both are consulted.
 *
 * Renders nothing until mounted: the server has no way to know the platform, and
 * emitting the Windows glyph would show it to Mac users for the length of the
 * hydration pass.
 */
function useIsApple() {
  const [isApple, setIsApple] = useState<boolean | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const hint = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    setIsApple(/mac|iphone|ipad|ipod/i.test(hint));
  }, []);

  return isApple;
}

export interface KbdProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Single letter or short token, e.g. `K`. */
  letter: string;
}

export function Kbd({ letter, className, ...props }: KbdProps) {
  const isApple = useIsApple();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border border-line bg-surface-2",
        "px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium text-ink-4",
        className,
      )}
      {...props}
    >
      {isApple ? (
        <>
          <span aria-hidden>⌘</span>
          <span className="font-mono">{letter}</span>
        </>
      ) : (
        <>
          <span>Ctrl</span>
          <span className="font-mono">{letter}</span>
        </>
      )}
    </span>
  );
}