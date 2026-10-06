"use client";

import { Bot, User, AlertCircle, RotateCcw, FileCode } from "lucide-react";
import { MessageRenderer } from "./MessageRenderer";
import type { ChatMessage, Citation } from "./types";

interface MessageBubbleProps {
  message: ChatMessage;
  onCitationClick: (citation: Citation) => void;
  onRetry?: () => void;
}

export function MessageBubble({ message, onCitationClick, onRetry }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isFailed = message.status === "failed";
  const isStreaming = message.status === "streaming";
  const citations = isUser ? [] : (message.citations ?? []);

  return (
    <div className={`flex gap-3 sm:gap-4 ${isUser ? "justify-end" : "justify-start"}`}>
      {/* Assistant Avatar */}
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-teal-400">
          <Bot className="h-4.5 w-4.5" />
        </div>
      )}

      {/* Bubble Box */}
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl border px-4 py-3 shadow transition ${
          isUser
            ? "bg-zinc-900 border-zinc-800 text-zinc-100"
            : isFailed
            ? "bg-red-950/20 border-red-900/40 text-red-300"
            : "bg-[#0c0c0e] border-zinc-900/80 text-zinc-300"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {isFailed && (
              <div className="flex items-center justify-between gap-2 text-xs text-red-400 font-semibold mb-2 pb-1 border-b border-red-900/30">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Response Failed</span>
                </div>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/30 hover:bg-red-900/50 active:scale-95 text-red-300 text-[11px] font-sans transition cursor-pointer"
                    title="Retry message generation"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}
            <MessageRenderer
              content={message.content}
              citations={message.citations}
              onCitationClick={onCitationClick}
              isStreaming={isStreaming}
            />
          </>
        )}

        {/* Streaming pulse for initial assistant placeholder */}
        {isStreaming && message.content === "" && (
          <div className="flex items-center gap-1.5 py-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-400 animate-bounce" />
            <span className="h-2 w-2 rounded-full bg-teal-400 animate-bounce [animation-delay:0.2s]" />
            <span className="h-2 w-2 rounded-full bg-teal-400 animate-bounce [animation-delay:0.4s]" />
          </div>
        )}

        {/* Sources: every retrieved snippet, clickable even when the model cited nothing inline */}
        {citations.length > 0 && (
          <div className="mt-3 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
              <FileCode className="h-3 w-3" />
              Sources
            </div>
            <div className="flex flex-wrap gap-1.5">
              {citations.map((citation) => (
                <button
                  key={`${citation.index}-${citation.filePath}-${citation.startLine}`}
                  type="button"
                  onClick={() => onCitationClick(citation)}
                  title={`${citation.filePath}:${citation.startLine}-${citation.endLine}`}
                  className="inline-flex items-center gap-1 max-w-full px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-400 hover:text-teal-300 border border-zinc-800 transition cursor-pointer"
                >
                  <span className="truncate">{citation.filePath.split("/").pop()}</span>
                  <span className="text-zinc-600 shrink-0">
                    {citation.startLine}-{citation.endLine}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Avatar */}
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
          <User className="h-4.5 w-4.5" />
        </div>
      )}
    </div>
  );
}
