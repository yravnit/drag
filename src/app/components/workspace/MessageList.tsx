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
  onEditMessage?: (content: string, messageId?: string) => void;
  onRetryMessage?: (message: ChatMessage) => void;
}

const PIN_THRESHOLD_PX = 80;

const SUGGESTED_PROMPTS = [
  "Where are API routes defined and how are they protected?",
  "How does repository chunking and tree-sitter parsing work?",
  "Explain the database schema and relationship models.",
];

function MessageListImpl({
  messages,
  isLoading,
  error,
  onCitationClick,
  onSuggestionClick,
  onEditMessage,
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
      if (el && isNearBottomRef.current) el.scrollTop = el.scrollHeight;
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
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <Loader2 className="mb-2 size-7 animate-spin text-accent" aria-hidden />
        <p className="text-xs text-chat-ink-3">Loading conversation history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-card border border-danger-soft bg-danger-soft text-danger">
          <AlertCircle className="size-5" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-chat-ink">Failed to load messages</p>
        <p className="mt-1 max-w-sm text-xs text-danger">{error}</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-card border border-chat-line bg-surface text-accent shadow-card">
          <Bot className="size-6" aria-hidden />
        </div>
        <h3 className="text-sm font-bold text-chat-ink">Start Chatting with Codebase</h3>
        <p className="mt-1 text-xs leading-relaxed text-chat-ink-3">
          Ask questions about function relationships, logic flow, architecture, or configuration in
          this repository.
        </p>

        {onSuggestionClick && (
          <div className="mt-6 w-full">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-4">
              Suggested Questions
            </span>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onSuggestionClick(prompt)}
                  className="cursor-pointer rounded-chip border border-chat-line bg-surface px-3 py-1.5 text-left text-xs text-chat-ink-2 transition-colors duration-150 hover:border-accent hover:bg-surface-2 hover:text-chat-ink active:scale-[0.98]"
                >
                  {prompt}
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
      className="scroll-thin flex-1 space-y-7 overflow-y-auto px-4 py-5 min-[901px]:px-14 min-[901px]:py-8"
    >
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onCitationClick={onCitationClick}
          onRetry={onRetryMessage ? () => onRetryMessage(msg) : undefined}
          onEdit={onEditMessage ? (content, id) => onEditMessage(content, id) : undefined}
        />
      ))}
    </div>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const MessageList = memo(MessageListImpl);
