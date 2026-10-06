"use client";

import React, { useState } from "react";
import {
  Menu,
  CheckCircle2,
  Loader2,
  Plus,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ModelSelector } from "./ModelSelector";
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
  onRetryMessage?: (message: ChatMessage) => void;
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;
  responseMode?: ResponseMode;
  onResponseModeChange?: (mode: ResponseMode) => void;
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
  onToggleMobileSidebar,
  onSuggestionClick,
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
  const branch = statusTracker?.defaultBranch || selectedRepo.defaultBranch;
  const language = statusTracker?.primaryLanguage || selectedRepo.primaryLanguage;
  const commitSha = statusTracker?.headCommitSha?.slice(0, 7);

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#050507]">
      {/* Top Header */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-zinc-900 bg-[#0d0d10]/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Mobile hamburger menu toggle */}
<button
                onClick={onToggleMobileSidebar}
                className="md:hidden p-1.5 hover:bg-zinc-800 active:scale-90 rounded-lg text-zinc-400 hover:text-white transition cursor-pointer"
                title="Toggle sidebar"
                aria-label="Toggle sidebar"
              >
            <Menu className="h-5 w-5" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white truncate max-w-[200px] sm:max-w-md">
                {selectedRepo.owner}/{selectedRepo.name}
              </h2>
              {currentStatus === "ready" && (
                <span className="h-2 w-2 rounded-full bg-emerald-500" title="Ready" />
              )}
              {currentStatus === "processing" && (
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" title="Indexing" />
              )}
              {currentStatus === "failed" && (
                <span className="h-2 w-2 rounded-full bg-red-500" title="Failed" />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono mt-0.5">
              {branch && <span className="text-zinc-400">{branch}</span>}
              {language && <span>· {language}</span>}
              {commitSha && <span>· {commitSha}</span>}
              {filesCount !== undefined && filesCount > 0 && (
                <span>
                  · {filesCount} files indexed{chunksCount ? ` · ${chunksCount} chunks` : ""}
                </span>
              )}
              {storageDisplay && <span>· {storageDisplay}</span>}
              {relativeSyncTime && <span>· {relativeSyncTime}</span>}
            </div>
          </div>
        </div>

        {/* Right header controls: Privacy indicator and dynamic ModelSelector */}
        <div className="flex items-center gap-3">
          {(statusTracker?.privacyLabel || selectedRepo.privacyLabel) && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  (statusTracker?.isPrivate ?? selectedRepo.isPrivate)
                    ? "bg-purple-950/50 text-purple-300 border border-purple-900/50"
                    : "bg-teal-950/50 text-teal-300 border border-teal-900/50"
                }`}
              >
                {statusTracker?.privacyLabel ?? selectedRepo.privacyLabel}
              </span>
            </div>
          )}

          {onSelectModel && (
            <ModelSelector
              selectedModel={selectedModel}
              onSelectModel={onSelectModel}
            />
          )}
        </div>
      </div>

      {/* Main View Area */}
      {!selectedConversation ? (
        /* Empty conversation state */
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
              <span
                className={`h-2 w-2 rounded-full ${
                  currentStatus === "ready"
                    ? "bg-emerald-400"
                    : currentStatus === "failed"
                    ? "bg-red-400"
                    : "bg-amber-400 animate-pulse"
                }`}
              />
              <span className="text-xs text-zinc-400 font-medium font-mono">
                {selectedRepo.owner}/{selectedRepo.name}
              </span>
            </div>
            {branch && (
              <span className="px-2.5 py-1 rounded-full bg-zinc-900/60 border border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                {branch}
              </span>
            )}
            {language && (
              <span className="px-2.5 py-1 rounded-full bg-zinc-900/60 border border-zinc-800/80 text-[11px] font-mono text-teal-400/80">
                {language}
              </span>
            )}
            {commitSha && (
              <span className="px-2.5 py-1 rounded-full bg-zinc-900/60 border border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                commit: {commitSha}
              </span>
            )}
            {(statusTracker?.privacyLabel || selectedRepo.privacyLabel) && (
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-mono border ${
                  (statusTracker?.isPrivate ?? selectedRepo.isPrivate)
                    ? "bg-purple-950/40 text-purple-300 border-purple-800/60"
                    : "bg-teal-950/40 text-teal-300 border-teal-800/60"
                }`}
              >
                {statusTracker?.privacyLabel ?? selectedRepo.privacyLabel} · {(statusTracker?.isPrivate ?? selectedRepo.isPrivate) ? "Protected embeddings" : "Embeddings ready"}
              </span>
            )}
            {storageDisplay && (
              <span className="px-2.5 py-1 rounded-full bg-zinc-900/60 border border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                storage: {storageDisplay}
              </span>
            )}
            {relativeSyncTime && (
              <span className="px-2.5 py-1 rounded-full bg-zinc-900/60 border border-zinc-800/80 text-[11px] font-mono text-zinc-400">
                {relativeSyncTime}
              </span>
            )}
          </div>

          {stage === "failed" ? (
            /* Failed indexing state with retry UX */
            <div className="max-w-md w-full bg-red-950/20 border border-red-900/30 rounded-2xl p-6 backdrop-blur space-y-4">
              <div className="h-10 w-10 rounded-full bg-red-900/30 border border-red-800 flex items-center justify-center mx-auto text-red-400">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Repository Indexing Failed</h3>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                  The background ingestion job encountered an issue while processing or embedding chunks. You can trigger a retry to re-index the repository.
                </p>
              </div>
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500 hover:bg-red-400 active:scale-95 px-4 py-2.5 text-xs font-bold text-zinc-950 transition disabled:opacity-60 cursor-pointer shadow"
              >
                {retrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {retrying ? "Restarting..." : "Retry / Re-index Repository"}
              </button>
              {retryError && (
                <p className="text-center text-xs text-red-400">{retryError}</p>
              )}
            </div>
          ) : stage !== "ready" ? (
            /* Dynamic Honest Indexing Progress Tracker */
            <div className="max-w-md w-full bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6 backdrop-blur space-y-6">
              <div className="text-center">
                <h3 className="text-sm font-bold text-white">
                  {stage === "preparing"
                    ? "Preparing Repository"
                    : stage === "indexing"
                    ? "Indexing Repository"
                    : "Embedding Codebase"}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
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

              <div className="space-y-4 text-left">
                {/* Step 1: Acquire */}
                <div className="flex items-center gap-3">
                  {stage === "preparing" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-teal-400 animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500/20 text-teal-400">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  )}
                  <span className="text-xs font-medium text-zinc-300">
                    {stage === "preparing"
                      ? "Acquiring tree and verifying size limits"
                      : "Repository acquired and verified"}
                  </span>
                </div>

                {/* Step 2: Parse / Chunk */}
                <div className="flex items-center gap-3">
                  {stage === "preparing" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-zinc-700" />
                  ) : stage === "indexing" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-teal-400 animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500/20 text-teal-400">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  )}
                  <span className="text-xs font-medium text-zinc-300">
                    {stage === "preparing"
                      ? "Generate semantic code chunks"
                      : stage === "indexing"
                      ? `Parsing files and generating chunks${filesCount ? ` (${filesCount} files)` : ""}`
                      : `Semantic chunks generated${filesCount ? ` (${filesCount} files, ${chunksCount ?? 0} chunks)` : ""}`}
                  </span>
                </div>

                {/* Step 3: Embed */}
                <div className="flex items-center gap-3">
                  {stage === "embedding" ? (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-teal-400 animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-zinc-700" />
                  )}
                  <span className="text-xs font-medium text-zinc-300">
                    {stage === "embedding"
                      ? embeddedChunksCount && chunksCount
                        ? `Computing embeddings (${embeddedChunksCount}/${chunksCount} chunks)`
                        : chunksCount
                        ? `Computing embeddings for ${chunksCount} chunks`
                        : "Computing vector embeddings"
                      : "Compute vector embeddings"}
                  </span>
                </div>
              </div>

              <div className="pt-2 text-center text-[10px] text-zinc-500 font-mono">
                {stage === "preparing"
                  ? "Preparing repository structure..."
                  : stage === "indexing"
                  ? "Parsing AST and chunking files..."
                  : "Vectorizing code chunks..."}
              </div>
            </div>
          ) : (
            /* Repository Ready State */
            <div className="space-y-4 max-w-md">
              <h2 className="text-lg font-bold text-white">Repository Ready</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Codebase index completed successfully
                {filesCount ? ` (${filesCount} files indexed${chunksCount ? `, ${chunksCount} chunks` : ""}${storageDisplay ? ` · ${storageDisplay}` : ""}).` : "."}
                {relativeSyncTime && ` ${relativeSyncTime}.`} Start a chat thread to ask questions about code structure, APIs, and logic.
              </p>
              <button
                onClick={handleStartConversation}
                disabled={starting}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-95 px-4 py-2.5 text-xs font-bold text-zinc-950 transition shadow disabled:opacity-60 cursor-pointer"
              >
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {starting ? "Starting..." : "Start Conversation"}
              </button>
              {startError && <p className="text-center text-xs text-red-400">{startError}</p>}
            </div>
          )}
        </div>
      ) : (
        /* Active Conversation Chat View */
        <>
          <MessageList
            messages={messages}
            isLoading={messagesLoading}
            error={messagesError}
            onCitationClick={onCitationClick}
            onSuggestionClick={onSuggestionClick}
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
          />
        </>
      )}
    </div>
  );
}
