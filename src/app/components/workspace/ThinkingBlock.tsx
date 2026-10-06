"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";

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
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/60 hover:bg-zinc-850 active:scale-95 border border-zinc-800 text-xs font-mono transition cursor-pointer select-none"
        title={isExpanded ? "Collapse thinking" : "Expand thinking"}
        aria-expanded={isExpanded}
      >
        <ChevronRight
          className={`h-3 w-3 text-zinc-500 transition-transform duration-150 ${
            isExpanded ? "rotate-90 text-teal-400" : ""
          }`}
        />
        <span className="thinking-linear-shimmer font-medium tracking-wide">
          {isThinkingActive ? "Thinking..." : "Thinking"}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 pl-3 border-l-2 border-zinc-800 text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto bg-zinc-950/60 p-3 rounded-r">
          {thinking}
        </div>
      )}
    </div>
  );
}
