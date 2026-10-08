"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, Pencil, RotateCcw } from "lucide-react";
import { MessageRenderer } from "./MessageRenderer";
import { CopyCodeButton } from "./CopyCodeButton";
import { formatClockTime } from "./formatters";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type Citation } from "./types";

/** Past this length a user prompt is clamped and gets a Show more toggle. */
const COLLAPSE_OVER_CHARS = 280;

const ACTION_ROW_ITEM =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-medium text-chat-ink-3 transition-colors duration-150 hover:bg-chat-3 hover:text-chat-ink active:scale-[0.96]";

/** How long the action row keeps the "Generating…" label before the stream takes over the feedback. */
const REGENERATE_FEEDBACK_MS = 900;

/**
 * `GET /api/conversations/[id]/messages` returns the row's `createdAt`, but the shared
 * `ChatMessage` type does not declare it. Read it optionally so optimistic rows without a
 * timestamp simply render no stamp instead of a fake one.
 */
type ChatMessageRow = ChatMessage & { createdAt?: string | null };

interface MessageBubbleProps {
  message: ChatMessage;
  onCitationClick: (citation: Citation) => void;
  onRetry?: () => void;
  onRegenerate?: () => void;
  onEdit?: (content: string, messageId?: string) => void;
}

export function MessageBubble({
  message,
  onCitationClick,
  onRetry,
  onRegenerate,
  onEdit,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isFailed = message.status === "failed";
  const isStreaming = message.status === "streaming";
  const citations = isUser ? [] : (message.citations ?? []);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(message.content);
  const [regenerating, setRegenerating] = useState(false);
  const regenerateTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(regenerateTimer.current), []);

  useEffect(() => {
    if (!isEditing) {
      setDraftContent(message.content);
    }
  }, [message.content, isEditing]);

  const isLong = isUser && message.content.length > COLLAPSE_OVER_CHARS;
  const clamped = isLong && !expanded;
  const stamp = formatClockTime((message as ChatMessageRow).createdAt);

  if (isUser) {
    if (isEditing) {
      return (
        <div className="flex flex-col items-end">
          <div className="min-w-[180px] max-w-[75%] rounded-[14px_14px_2px_14px] border border-bubble-line bg-bubble p-2.5 text-bubble-ink shadow-card">
            <div className="grid max-h-[220px]">
              <span
                className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words p-2 text-sm leading-relaxed border border-transparent select-none pointer-events-none max-h-[220px] overflow-hidden"
                aria-hidden
              >
                {draftContent || " "}
              </span>
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditing(false);
                    setDraftContent(message.content);
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (
                      draftContent.trim() &&
                      draftContent.trim().length <= MAX_CHAT_MESSAGE_LENGTH
                    ) {
                      setIsEditing(false);
                      onEdit?.(draftContent.trim(), message.id);
                    }
                  }
                }}
                autoFocus
                placeholder="Edit message..."
                aria-label="Edit message"
                className="col-start-1 row-start-1 w-full h-full min-h-[38px] max-h-[220px] resize-none overflow-y-auto rounded-[8px] border border-line bg-surface p-2 text-sm leading-relaxed text-ink placeholder:text-ink-4 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 shadow-none"
              />
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setDraftContent(message.content);
                }}
                className="cursor-pointer rounded-[6px] border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.96]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    draftContent.trim() &&
                    draftContent.trim().length <= MAX_CHAT_MESSAGE_LENGTH
                  ) {
                    setIsEditing(false);
                    onEdit?.(draftContent.trim(), message.id);
                  }
                }}
                disabled={
                  !draftContent.trim() ||
                  draftContent.trim().length > MAX_CHAT_MESSAGE_LENGTH
                }
                title="Save edit"
                aria-label="Save edit"
                className="cursor-pointer rounded-[6px] bg-accent px-3 py-1 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96]"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      );
    }

    const isTemp = !message.id || message.id.startsWith("temp-");

    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[75%] rounded-[14px_14px_2px_14px] border border-bubble-line bg-bubble px-4 py-2.5 text-bubble-ink shadow-card">
          {/* `line-clamp-6` must stay a literal: Tailwind scans source text for whole class
              names, so an interpolated `line-clamp-${n}` is never generated. Clamping in CSS
              also means no measuring pass, which is what a JS height check would cost on every
              streamed message. */}
          <p className={`text-sm whitespace-pre-wrap ${clamped ? "line-clamp-6" : ""}`}>
            {message.content}
          </p>
          {isLong && (
            <div className="-mb-1 mt-1.5 flex items-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="cursor-pointer rounded-[6px] px-2 py-1 text-[12px] text-chat-ink-3 transition-colors duration-150 hover:bg-bubble-line/60 hover:text-chat-ink active:scale-[0.96]"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            </div>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setDraftContent(message.content);
              setIsEditing(true);
            }}
            disabled={isTemp}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-medium text-chat-ink-3 transition-colors duration-150 hover:bg-chat-3 hover:text-chat-ink active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
            title={isTemp ? "Cannot edit while message is sending" : "Edit message"}
            aria-label="Edit message"
          >
            <Pencil className="size-3" aria-hidden />
            <span>Edit</span>
          </button>
          <CopyCodeButton text={message.content} />
        </div>
      </div>
    );
  }

  const waiting = isStreaming && message.content === "";

  const handleRegenerate = () => {
    if (!onRegenerate || regenerating) return;
    setRegenerating(true);
    clearTimeout(regenerateTimer.current);
    regenerateTimer.current = setTimeout(() => setRegenerating(false), REGENERATE_FEEDBACK_MS);
    onRegenerate();
  };

  return (
    <div>
      {waiting && (
        <div className="mb-1 text-[11px] font-medium text-ink-4">
          Generating response…
        </div>
      )}

      {isFailed && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-[6px] border border-danger-soft bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="size-3.5" aria-hidden />
            <span>Response Failed</span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] bg-danger/15 px-2 py-1 text-[11px] text-danger transition-colors duration-150 hover:bg-danger/25 active:scale-[0.96]"
              title="Retry message generation"
            >
              <RotateCcw className="size-3" aria-hidden />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {waiting ? (
        <div className="max-w-[640px] py-1">
          <div className="shimmer-line h-3.5 w-[85%] rounded-[6px]" />
          <div className="shimmer-line mt-2.5 h-3.5 w-[96%] rounded-[6px]" />
          <div className="shimmer-line mt-2.5 h-3.5 w-[60%] rounded-[6px]" />
          <div className="mt-3.5 text-[13px] text-chat-ink-3">
            Searching repository chunks
            <span className="streaming-cursor ml-1.5" aria-hidden />
          </div>
        </div>
      ) : (
        <MessageRenderer
          content={message.content}
          citations={message.citations}
          onCitationClick={onCitationClick}
          isStreaming={isStreaming}
        />
      )}

      {!waiting && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <CopyCodeButton text={message.content} />

            {!isFailed && onRegenerate && (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenerating}
                className={ACTION_ROW_ITEM}
                title="Regenerate response"
              >
                <RotateCcw
                  className={`size-3 ${regenerating ? "animate-spin-slow" : ""}`}
                  aria-hidden
                />
                <span>{regenerating ? "Generating..." : "Regenerate"}</span>
              </button>
            )}

            {citations.length > 0 && (
              <button
                type="button"
                onClick={() => onCitationClick(citations[0])}
                className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] bg-accent-soft px-2 py-1 text-[11px] font-bold text-accent-ink transition-[filter,background-color] duration-150 hover:brightness-95 active:scale-[0.96]"
                title="Open the cited source"
              >
                <FileText className="size-3" aria-hidden />
                <span>
                  {citations.length} source{citations.length > 1 ? "s" : ""}
                </span>
              </button>
            )}

            {stamp && (
              <span className="ml-auto text-[11px] tabular-nums text-chat-ink-3">{stamp}</span>
            )}
          </div>

          {citations.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-semibold text-chat-ink-3">Sources:</span>
              {citations.map((citation) => (
                <button
                  key={`${citation.index}-${citation.filePath}-${citation.startLine}`}
                  type="button"
                  onClick={() => onCitationClick(citation)}
                  title={`${citation.filePath}:${citation.startLine}-${citation.endLine}`}
                  aria-label={`View source citation ${citation.index}: ${citation.filePath}`}
                  className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-[6px] border border-chat-line bg-chat-2 px-2 py-[2px] text-[11px] text-chat-ink-2 transition-colors duration-150 hover:bg-chat-3 hover:text-chat-ink active:scale-[0.96]"
                >
                  <FileText className="size-[11px] shrink-0 text-accent" aria-hidden />
                  <span className="truncate">{citation.filePath.split("/").pop()}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
