"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

const ACTION = "cursor-pointer rounded-[6px] px-2 py-1 text-[12px] font-medium";

/**
 * Copy button for code and diagram source blocks and for the message action row.
 * One component so the transient "Copied!" state looks the same everywhere.
 */
export function CopyCodeButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text}
      className={cn(
        "inline-flex items-center gap-1.5 transition-colors duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
        ACTION,
        copied ? "bg-ok-soft text-ok" : "text-chat-ink-3 hover:bg-chat-3 hover:text-chat-ink",
        className,
      )}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      <span>{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
}
