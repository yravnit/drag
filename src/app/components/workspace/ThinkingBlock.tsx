"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface ThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
  hasAnswer?: boolean;
}

export function ThinkingBlock({
  thinking,
  isStreaming = false,
  hasAnswer = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isThinkingActive = isStreaming && !hasAnswer;

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-[6px] border border-chat-line bg-surface-2 px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-surface-3 active:scale-[0.96]"
        title={isExpanded ? "Collapse thinking" : "Expand thinking"}
        aria-expanded={isExpanded}
      >
        <ChevronRight
          className={cn(
            "size-3 text-chat-ink-3 transition-transform duration-150",
            isExpanded && "rotate-90 text-accent",
          )}
          aria-hidden
        />
        <span className="thinking-linear-shimmer font-semibold tracking-wide">
          {isThinkingActive ? "Thinking..." : "Thinking"}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 max-h-60 overflow-y-auto rounded-r-[6px] border-l-2 border-chat-line bg-chat-2 p-3 pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-chat-ink-2">
          {thinking}
        </div>
      )}
    </div>
  );
}
