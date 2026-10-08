"use client";

import React, { useState } from "react";
import { AlertCircle, Check, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { formatBytes, formatRelativeSyncTime } from "./formatters";
import type {
  WorkspaceRepository,
  ConversationThread,
  ChatMessage,
  Citation,
  StatusTracker,
  ResponseMode,
} from "./types";

interface ChatWindowProps {
  selectedRepo: WorkspaceRepository;
  selectedConversation: ConversationThread | null;
  statusTracker: StatusTracker | null;
  messages: ChatMessage[];
  messagesLoading?: boolean;
  messagesError?: string | null;
  messageText: string;
  isStreaming: boolean;
  chatError: string;
  onMessageChange: (text: string) => void;
  onSendMessage: (e: React.FormEvent) => void;
  onCitationClick: (citation: Citation) => void;
  onCreateConversation: () => void | Promise<void>;
  onRetryRepo: (repo: WorkspaceRepository) => void | Promise<void>;
  onToggleMobileSidebar: () => void;
  onSuggestionClick?: (prompt: string) => void;
  onEditMessage?: (content: string, messageId?: string) => void;
  onRetryMessage?: (message: ChatMessage) => void;
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;
  responseMode?: ResponseMode;
  onResponseModeChange?: (mode: ResponseMode) => void;
}

interface StageStep {
  label: string;
  detail: string;
  state: "pending" | "active" | "done";
}

export function ChatWindow({
  selectedRepo,
  selectedConversation,
  statusTracker,
  messages,
  messagesLoading,
  messagesError,
  messageText,
  isStreaming,
  chatError,
  onMessageChange,
  onSendMessage,
  onCitationClick,
  onCreateConversation,
  onRetryRepo,
  onSuggestionClick,
  onEditMessage,
  onRetryMessage,
  selectedModel = "default",
  onSelectModel,
  responseMode = "precise",
  onResponseModeChange,
}: ChatWindowProps) {
  const currentStatus = statusTracker?.embeddingStatus || selectedRepo.embeddingStatus || "processing";
  const filesCount = statusTracker?.filesIndexed ?? selectedRepo.filesIndexed;
  const chunksCount = statusTracker?.chunksCount ?? selectedRepo.chunksCount;
  const embeddedChunksCount = statusTracker?.embeddedChunksCount;
  const totalSizeBytes = statusTracker?.totalSizeBytes ?? selectedRepo.totalSizeBytes;
  const storageDisplay = formatBytes(totalSizeBytes);
  const indexedTimestamp = statusTracker?.indexedAt || selectedRepo.indexedAt;
  const relativeSyncTime = formatRelativeSyncTime(indexedTimestamp);

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const handleStartConversation = async () => {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      await onCreateConversation();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start a new chat.");
    } finally {
      setStarting(false);
    }
  };

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      await onRetryRepo(selectedRepo);
    } catch (err) {
      setRetryError(
        err instanceof Error ? err.message : "Could not restart indexing for this repository.",
      );
    } finally {
      setRetrying(false);
    }
  };

  const stage: "preparing" | "indexing" | "embedding" | "ready" | "failed" =
    statusTracker?.stage ||
    (currentStatus === "failed"
      ? "failed"
      : currentStatus === "ready"
        ? "ready"
        : (filesCount ?? 0) === 0 && (chunksCount ?? 0) === 0
          ? "preparing"
          : (chunksCount ?? 0) === 0
            ? "indexing"
            : "embedding");

  const stageIndex = stage === "preparing" ? 0 : stage === "indexing" ? 1 : 2;

  const stageSteps: StageStep[] = [
    {
      label: "Acquire",
      detail:
        stageIndex > 0
          ? "Repository acquired and verified"
          : "Acquiring tree and verifying size limits",
      state: stageIndex > 0 ? "done" : "active",
    },
    {
      label: "Chunk",
      detail:
        stageIndex > 1
          ? `Semantic chunks generated${filesCount ? ` (${filesCount} files, ${chunksCount ?? 0} chunks)` : ""}`
          : stageIndex === 1
            ? `Parsing files and generating chunks${filesCount ? ` (${filesCount} files)` : ""}`
            : "Generate semantic code chunks",
      state: stageIndex > 1 ? "done" : stageIndex === 1 ? "active" : "pending",
    },
    {
      label: "Embed",
      detail:
        stageIndex === 2
          ? embeddedChunksCount && chunksCount
            ? `Computing embeddings (${embeddedChunksCount}/${chunksCount} chunks)`
            : chunksCount
              ? `Computing embeddings for ${chunksCount} chunks`
              : "Computing vector embeddings"
          : "Compute vector embeddings",
      state: stageIndex === 2 ? "active" : "pending",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-chat">

      {!selectedConversation ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">

          {stage === "failed" ? (
            <div className="w-full max-w-md space-y-4 rounded-card border border-danger-soft bg-danger-soft/40 p-6">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-danger-soft bg-danger-soft text-danger">
                <AlertCircle className="size-5" aria-hidden />
              </div>
              <div>
                <h3 className="text-lg font-semibold tracking-display text-chat-ink">
                  Repository Indexing Failed
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-chat-ink-2">
                  The background ingestion job encountered an issue while processing or embedding
                  chunks. You can trigger a retry to re-index the repository.
                </p>
              </div>
              <Button variant="outline" onClick={handleRetry} disabled={retrying}>
                {retrying ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-4" aria-hidden />
                )}
                {retrying ? "Restarting..." : "Retry / Re-index Repository"}
              </Button>
              {retryError && <p className="text-center text-xs text-danger">{retryError}</p>}
            </div>
          ) : stage !== "ready" ? (
            <div className="w-full max-w-md space-y-5 rounded-card border border-chat-line bg-surface p-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold tracking-display text-chat-ink">
                  {stage === "preparing"
                    ? "Preparing Repository"
                    : stage === "indexing"
                      ? "Indexing Repository"
                      : "Embedding Codebase"}
                </h3>
                <p className="mt-1 text-xs text-chat-ink-3">
                  {stage === "preparing"
                    ? "Acquiring repository files and verifying size limits."
                    : stage === "indexing"
                      ? filesCount && filesCount > 0
                        ? `Parsing files and generating chunks (${filesCount} files discovered).`
                        : "Parsing codebase files into semantic chunks."
                      : embeddedChunksCount && chunksCount
                        ? `Computing vector embeddings (${embeddedChunksCount} / ${chunksCount} chunks).`
                        : chunksCount
                          ? `Computing vector embeddings for ${chunksCount} chunks.`
                          : "Computing vector embeddings."}
                </p>
              </div>

              <ol className="space-y-3 text-left">
                {stageSteps.map((step) => (
                  <li key={step.label} className="flex items-center gap-3">
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
                        step.state === "done"
                          ? "border-transparent bg-accent-soft text-accent-ink"
                          : step.state === "active"
                            ? "border-transparent bg-accent-soft text-accent-ink animate-pulse"
                            : "border-chat-line bg-surface-2 text-ink-4"
                      }`}
                    >
                      {step.state === "done" ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : step.state === "active" ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-chat-ink">
                        {step.label}
                      </span>
                      <span className="block text-[11px] text-chat-ink-3">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <p className="border-t border-chat-line pt-3 text-center text-[11px] text-chat-ink-3">
                {stage === "preparing"
                  ? "Preparing repository structure..."
                  : stage === "indexing"
                    ? "Parsing AST and chunking files..."
                    : "Vectorizing code chunks..."}
              </p>
            </div>
          ) : (
            <div className="max-w-md space-y-4">
              <h2 className="text-2xl font-display tracking-display text-chat-ink">
                Repository Ready
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-chat-ink-2">
                Codebase index completed successfully
                {filesCount
                  ? ` (${filesCount} files indexed${chunksCount ? `, ${chunksCount} chunks` : ""}${storageDisplay ? ` · ${storageDisplay}` : ""}).`
                  : "."}
                {relativeSyncTime && ` ${relativeSyncTime}.`} Start a chat thread to ask questions
                about code structure, APIs, and logic.
              </p>
              <Button onClick={handleStartConversation} disabled={starting}>
                {starting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
                {starting ? "Starting..." : "Start Conversation"}
              </Button>
              {startError && <p className="text-center text-xs text-danger">{startError}</p>}
            </div>
          )}
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            isLoading={messagesLoading}
            error={messagesError}
            onCitationClick={onCitationClick}
            onSuggestionClick={onSuggestionClick}
            onEditMessage={onEditMessage}
            onRetryMessage={onRetryMessage}
          />

          <Composer
            messageText={messageText}
            isStreaming={isStreaming}
            chatError={chatError}
            responseMode={responseMode}
            onResponseModeChange={onResponseModeChange}
            onMessageChange={onMessageChange}
            onSubmit={onSendMessage}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
          />
        </>
      )}
    </div>
  );
}
