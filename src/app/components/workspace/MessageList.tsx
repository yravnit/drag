"use client";

import { memo, useEffect, useRef } from "react";
import { Bot, Loader2, AlertCircle } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import type { ChatMessage, Citation } from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
  error?: string | null;
  onCitationClick: (citation: Citation) => void;
  onSuggestionClick?: (prompt: string) => void;
  onRetryMessage?: (message: ChatMessage) => void;
}

const PIN_THRESHOLD_PX = 80;

function MessageListImpl({
  messages,
  isLoading,
  error,
  onCitationClick,
  onSuggestionClick,
  onRetryMessage,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const frameRef = useRef<number | null>(null);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
  };

  // Pin to the bottom by writing `scrollTop` on the list itself, once per frame.
  //
  // `scrollIntoView({behavior:"smooth"})` was the cause of the jumping: a stream replaces the
  // messages array on every chunk, so a smooth-scroll animation restarted on each one and never
  // settled, its target was computed before the content finished growing (so it landed past the
  // last line), and it scrolls every scrollable ancestor rather than just this list. Chrome also
  // freezes those animations in a backgrounded tab and resolves them against a stale target on
  // refocus, which is the jump when you come back to the window.
  useEffect(() => {
    if (!isNearBottomRef.current || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const el = containerRef.current;
      // Reading scrollHeight flushes layout, so this is the height after the newest chunk.
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  // Cancels only on unmount. Cleaning up inside the effect above would cancel the pending frame on
  // every chunk and defeat the coalescing, leaving the list unpinned while tokens stream in.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-teal-400 mb-2" />
        <p className="text-xs text-zinc-400">Loading conversation history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="h-10 w-10 rounded-xl bg-red-950/40 border border-red-900/50 flex items-center justify-center text-red-400 mb-3">
          <AlertCircle className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-zinc-200">Failed to load messages</p>
        <p className="text-xs text-red-400 mt-1 max-w-sm">{error}</p>
      </div>
    );
  }

  if (messages.length === 0) {
    const suggestedPrompts = [
      "Where are API routes defined and how are they protected?",
      "How does repository chunking and tree-sitter parsing work?",
      "Explain the database schema and relationship models.",
    ];

    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 max-w-lg mx-auto">
        <div className="h-12 w-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-teal-400 mb-4 shadow">
          <Bot className="h-6 w-6" />
        </div>
        <h3 className="font-bold text-zinc-100 text-sm">Start Chatting with Codebase</h3>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          Ask questions about function relationships, logic flow, architecture, or configuration in this repository.
        </p>

        {onSuggestionClick && (
          <div className="mt-6 w-full space-y-2">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Suggested Questions</span>
            <div className="space-y-1.5 mt-2">
              {suggestedPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => onSuggestionClick(prompt)}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl border border-zinc-850 hover:border-zinc-600 active:scale-[0.99] bg-zinc-900/40 hover:bg-zinc-900 text-xs text-zinc-300 hover:text-zinc-100 transition cursor-pointer"
                >
                  &ldquo;{prompt}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
    >
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onCitationClick={onCitationClick}
          onRetry={onRetryMessage ? () => onRetryMessage(msg) : undefined}
        />
      ))}
    </div>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const MessageList = memo(MessageListImpl);
