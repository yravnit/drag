"use client";

import React from "react";
import { Send, ShieldAlert, Loader2 } from "lucide-react";
import { MAX_CHAT_MESSAGE_LENGTH, type ResponseMode } from "./types";

/** Show the remaining count only once the prompt is close enough for the limit to matter. */
const COUNTER_THRESHOLD = MAX_CHAT_MESSAGE_LENGTH * 0.9;

interface ComposerProps {
  messageText: string;
  isStreaming: boolean;
  chatError: string;
  responseMode?: ResponseMode;
  onResponseModeChange?: (mode: ResponseMode) => void;
  onMessageChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function Composer({
  messageText,
  isStreaming,
  chatError,
  responseMode = "precise",
  onResponseModeChange,
  onMessageChange,
  onSubmit,
}: ComposerProps) {
  // The textarea grows natively via `field-sizing-content`. The old resize effect set
  // `style.height = "auto"` and read `scrollHeight` on every keystroke, forcing a synchronous
  // reflow of the document per character, and because the composer's height feeds the message
  // list's box it also invalidated that container's scroll geometry on each character.

  // `maxLength` does the limiting natively, so there is no truncation path to keep in sync and the
  // server-side check in POST /api/chat stays a backstop rather than the thing the user hits.
  const remaining = MAX_CHAT_MESSAGE_LENGTH - messageText.length;
  const showCounter = remaining <= MAX_CHAT_MESSAGE_LENGTH - COUNTER_THRESHOLD;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (messageText.trim() && !isStreaming) {
        onSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  return (
    <div className="p-3 sm:p-4 border-t border-zinc-900 bg-[#0d0d10]/40 space-y-2">
      {chatError && (
        <div className="max-w-3xl mx-auto flex items-center gap-2 p-2.5 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-400">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="truncate">{chatError}</span>
        </div>
      )}

      {onResponseModeChange && (
        <div className="max-w-3xl mx-auto flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Mode</span>
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 p-0.5 rounded-lg">
              {(
                [
                  { id: "precise", label: "Concise", description: "Direct, concise answers" },
                  { id: "detailed", label: "Deep", description: "Comprehensive architectural and code breakdown" },
                  { id: "explain_simply", label: "Simple", description: "Plain, accessible explanations" },
                ] as const
              ).map((m) => {
                const isSelected = responseMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onResponseModeChange(m.id)}
                    disabled={isStreaming}
                    title={m.description}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                      isSelected
                        ? "bg-zinc-800 text-teal-300 font-semibold shadow-xs"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="max-w-3xl mx-auto flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <textarea
            rows={1}
            value={messageText}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the codebase... (Enter to send, Shift+Enter for newline)"
            disabled={isStreaming}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            className="w-full resize-none [field-sizing:content] bg-zinc-900/60 hover:bg-zinc-900 focus:bg-zinc-900 border border-zinc-800 hover:border-zinc-700/80 focus:border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition disabled:opacity-50 min-h-[46px] max-h-40 leading-5 overflow-y-auto"
          />
          {showCounter && (
            <div
              className={`mt-1 text-right text-[11px] tabular-nums ${
                remaining <= 100 ? "text-amber-400" : "text-zinc-500"
              }`}
            >
              {remaining.toLocaleString()} chars left
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={!messageText.trim() || isStreaming}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 transition active:scale-95 disabled:bg-zinc-900 disabled:text-zinc-650 cursor-pointer shrink-0"
          title="Send message (Enter)"
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>
    </div>
  );
}
