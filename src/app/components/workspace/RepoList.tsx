"use client";

import React, { useState } from "react";
import { Trash2, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { formatBytes, formatRelativeSyncTime } from "./formatters";
import type { WorkspaceRepository } from "./types";

interface RepoListProps {
  repositories: WorkspaceRepository[];
  selectedRepo: WorkspaceRepository | null;
  isLoading?: boolean;
  error?: string | null;
  onSelectRepo: (repo: WorkspaceRepository) => void;
  onDeleteRepo: (repoId: string) => void | Promise<void>;
  onRetryRepo: (repo: WorkspaceRepository) => void | Promise<void>;
  onOpenAddModal: () => void;
}

export function RepoList({
  repositories,
  selectedRepo,
  isLoading,
  error,
  onSelectRepo,
  onDeleteRepo,
  onRetryRepo,
  onOpenAddModal,
}: RepoListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const runAction = async (repo: WorkspaceRepository, action: "retry" | "delete") => {
    if (pendingId) return;
    setPendingId(repo.id);
    setActionError("");
    try {
      if (action === "retry") await onRetryRepo(repo);
      else await onDeleteRepo(repo.id);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : action === "retry"
            ? "Could not restart indexing."
            : "Could not remove this repository.",
      );
    } finally {
      setPendingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-teal-400 mx-auto mb-2" />
        <p className="text-xs text-zinc-500">Loading repositories...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-center">
        <AlertCircle className="h-4 w-4 text-red-400 mx-auto mb-1" />
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="p-4 text-center border border-dashed border-zinc-900 rounded-xl bg-zinc-950/20">
        <p className="text-xs text-zinc-500">No repositories indexed.</p>
        <button
          onClick={onOpenAddModal}
          className="mt-2 text-xs font-semibold text-teal-400 hover:text-teal-300 hover:underline transition active:scale-95 cursor-pointer"
        >
          Add Repository
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {actionError && (
        <div className="mb-1 flex items-start gap-1.5 rounded-lg border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-[11px] text-red-400">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
      {repositories.map((repo) => {
        const isSelected = selectedRepo?.id === repo.id;
        const status = repo.embeddingStatus || "processing";
        const isPending = pendingId === repo.id;

        return (
          <div
            key={repo.id}
            role="button"
            tabIndex={0}
            aria-current={isSelected}
            onClick={() => !isPending && onSelectRepo(repo)}
            onKeyDown={(e) => {
              if (isPending) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectRepo(repo);
              }
            }}
            className={`group relative flex flex-col rounded-xl border p-3 transition cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${
              isSelected
                ? "border-teal-500/50 bg-teal-500/10 text-white shadow-xs"
                : "border-transparent bg-zinc-950/20 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-100"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-xs truncate max-w-[170px]">
                {repo.owner}/{repo.name}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {status === "ready" && (
                  <span className="h-2 w-2 rounded-full bg-emerald-500" title="Ready" />
                )}
                {status === "processing" && (
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" title="Indexing" />
                )}
                {status === "failed" && (
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-500" title="Indexing Failed" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void runAction(repo, "retry");
                      }}
                      disabled={isPending}
                      title="Retry indexing"
                      aria-label={`Retry indexing ${repo.owner}/${repo.name}`}
                      className="p-1 rounded transition cursor-pointer text-red-400 hover:bg-red-900/40 hover:text-red-300 active:scale-90 disabled:opacity-50"
                    >
                      {isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void runAction(repo, "delete");
                  }}
                  disabled={isPending}
                  title="Remove repository"
                  aria-label={`Remove ${repo.owner}/${repo.name}`}
                  className="p-1 rounded transition cursor-pointer text-zinc-500 hover:bg-zinc-800 hover:text-red-400 active:scale-90 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono mt-1">
              <div className="flex items-center gap-1.5 truncate">
                <span>{repo.defaultBranch || "main"}</span>
                {repo.totalSizeBytes && formatBytes(repo.totalSizeBytes) && (
                  <span>· {formatBytes(repo.totalSizeBytes)}</span>
                )}
                {formatRelativeSyncTime(repo.indexedAt) && (
                  <span>· {formatRelativeSyncTime(repo.indexedAt)}</span>
                )}
              </div>
              {status === "failed" && (
                <span className="text-red-400 text-[9px] font-sans shrink-0">Failed</span>
              )}
              {status === "processing" && (
                <span className="text-amber-400 text-[9px] font-sans shrink-0">Indexing</span>
              )}
            </div>

            {/* Server-provided repository privacy indicator */}
            {repo.privacyLabel && (
              <div className="flex items-center gap-1.5 text-[10px] mt-1.5 pt-1.5 border-t border-zinc-900/80 font-sans">
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                    repo.isPrivate
                      ? "bg-purple-950/50 text-purple-300 border border-purple-900/50"
                      : "bg-teal-950/50 text-teal-300 border border-teal-900/50"
                  }`}
                >
                  {repo.privacyLabel}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
