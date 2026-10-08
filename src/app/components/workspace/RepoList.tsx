"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  GripVertical,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes, formatRelativeSyncTime } from "./formatters";
import type { ReorderRepositoriesHandler, WorkspaceRepository } from "./types";

type DropPosition = "top" | "bottom";

export interface RepoListProps {
  repositories: WorkspaceRepository[];
  selectedRepo: WorkspaceRepository | null;
  isLoading?: boolean;
  error?: string | null;
  onSelectRepo: (repo: WorkspaceRepository) => void;
  onDeleteRepo: (repoId: string) => void | Promise<void>;
  onRetryRepo: (repo: WorkspaceRepository) => void | Promise<void>;
  onOpenAddModal: () => void;
  onReorderRepositories?: ReorderRepositoriesHandler;
}

function moveItem<T extends { id: string }>(
  list: T[],
  sourceId: string,
  targetId: string,
  position: DropPosition,
): T[] {
  const sourceIndex = list.findIndex((item) => item.id === sourceId);
  if (sourceIndex === -1) return list;
  const rest = list.filter((_, index) => index !== sourceIndex);
  const targetIndex = rest.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return list;
  const at = position === "top" ? targetIndex : targetIndex + 1;
  return [...rest.slice(0, at), list[sourceIndex], ...rest.slice(at)];
}

function DropIndicator({ position }: { position: DropPosition }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1.5 h-0.5 rounded-full bg-accent",
        position === "top" ? "-top-px" : "-bottom-px",
      )}
    />
  );
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
  onReorderRepositories,
}: RepoListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(
    null,
  );
  const canReorder = Boolean(onReorderRepositories);

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

  const commitOrder = (ordered: WorkspaceRepository[]) => {
    onReorderRepositories?.(ordered.map((repo) => repo.id));
  };

  const nudge = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= repositories.length) return;
    const ordered = [...repositories];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    commitOrder(ordered);
  };

  const clearDrag = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  // Only take over the panel on the first load. A background refetch must not replace the user's
  // list with a spinner and then pop it back — that blink is what made the sidebar look cheap.
  if (isLoading && repositories.length === 0) {
    return (
      <div className="px-3 py-4 text-center">
        <Loader2 className="mx-auto mb-2 size-5 animate-spin text-accent" aria-hidden />
        <p className="text-xs text-ink-4">Loading repositories...</p>
      </div>
    );
  }

  // Only replaces the list when there is nothing to show. A failed action (a rejected
  // reorder, say) also lands in `error`, and replacing a populated list with the error
  // card would hide the very rows the user just tried to reorder.
  if (error && repositories.length === 0) {
    return (
      <div className="mx-2 rounded-control border border-danger-soft bg-danger-soft p-3 text-center">
        <AlertCircle className="mx-auto mb-1 size-4 text-danger" aria-hidden />
        <p className="text-xs text-danger">{error}</p>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="mx-2 rounded-card border border-dashed border-line bg-surface/60 p-4 text-center">
        <p className="text-xs text-ink-4">No repositories indexed.</p>
        <button
          type="button"
          onClick={onOpenAddModal}
          className="mt-2 cursor-pointer text-xs font-semibold text-accent-ink transition-colors duration-150 hover:underline active:scale-95"
        >
          Add Repository
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {error && (
        <div className="mx-2 mb-1 flex items-start gap-1.5 rounded-control border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {actionError && (
        <div className="mx-2 mb-1 flex items-start gap-1.5 rounded-control border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {repositories.map((repo, index) => {
        const isSelected = selectedRepo?.id === repo.id;
        const status = repo.embeddingStatus || "processing";
        const isPending = pendingId === repo.id;
        const isDragging = draggedId === repo.id;
        const isDropTop = dropTarget?.id === repo.id && dropTarget.position === "top";
        const isDropBottom = dropTarget?.id === repo.id && dropTarget.position === "bottom";

        return (
          <div
            key={repo.id}
            role="button"
            tabIndex={0}
            aria-current={isSelected}
            draggable={canReorder}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", repo.id);
              event.dataTransfer.effectAllowed = "move";
              setDraggedId(repo.id);
            }}
            onDragEnd={clearDrag}
            onDragOver={(event) => {
              if (!draggedId || draggedId === repo.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              setDropTarget({
                id: repo.id,
                position: event.clientY - bounds.top < bounds.height / 2 ? "top" : "bottom",
              });
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropTarget((prev) => (prev?.id === repo.id ? null : prev));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedId && dropTarget && draggedId !== repo.id) {
                commitOrder(moveItem(repositories, draggedId, repo.id, dropTarget.position));
              }
              clearDrag();
            }}
            onClick={() => !isPending && onSelectRepo(repo)}
            onKeyDown={(event) => {
              if (isPending) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectRepo(repo);
              }
            }}
            className={cn(
              "group relative cursor-pointer rounded-control border border-transparent px-2 py-2 transition-colors duration-150 active:scale-[0.99]",
              isSelected
                ? "bg-rail-active text-rail-active-ink"
                : "text-ink-2 hover:bg-rail-hover hover:text-ink",
              isDragging && "bg-rail-hover opacity-40",
            )}
          >
            {isDropTop && <DropIndicator position="top" />}
            {isDropBottom && <DropIndicator position="bottom" />}

            <div className="flex items-center gap-1.5">
              {canReorder && (
                <button
                  type="button"
                  draggable={false}
                  tabIndex={0}
                  aria-label={`Reorder ${repo.owner}/${repo.name}. Press the up or down arrow key to move it.`}
                  title="Drag to reorder"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    const offset =
                      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                    if (offset === 0) return;
                    event.preventDefault();
                    nudge(index, offset);
                  }}
                  className="shrink-0 cursor-grab rounded-[4px] p-0.5 text-ink-4 opacity-60 transition-opacity duration-150 group-hover:opacity-100 hover:bg-surface-2 hover:text-ink-2 focus-visible:opacity-100 active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" aria-hidden />
                </button>
              )}

              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.02em]">
                {repo.owner}/{repo.name}
              </span>

              <div className="flex shrink-0 items-center gap-1">
                {/* No "ready" dot: it was on for essentially every indexed repo, so it carried no
                    information. Indexing and failure still show a dot because those need watching,
                    and both are also spelled out in the status line below. */}
                {status === "processing" && (
                  <span
                    className="size-2 animate-pulse rounded-full bg-amber-500"
                    title="Indexing"
                  />
                )}
                {status === "failed" && (
                  <div className="flex items-center gap-1">
                    <span className="size-2 rounded-full bg-danger" title="Indexing failed" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void runAction(repo, "retry");
                      }}
                      disabled={isPending}
                      title="Retry indexing"
                      aria-label={`Retry indexing ${repo.owner}/${repo.name}`}
                      className="cursor-pointer rounded-[4px] p-0.5 text-danger transition-colors duration-150 hover:bg-danger-soft disabled:opacity-50"
                    >
                      {isPending ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="size-3" aria-hidden />
                      )}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void runAction(repo, "delete");
                  }}
                  disabled={isPending}
                  title="Remove repository"
                  aria-label={`Remove ${repo.owner}/${repo.name}`}
                  className="cursor-pointer rounded-[4px] p-0.5 text-ink-4 transition-[opacity,color,background-color] duration-150 hover:bg-surface-2 hover:text-danger disabled:opacity-50 focus-visible:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                >
                  {isPending ? (
                    <Loader2 className="size-3.5 animate-spin text-ink-3" aria-hidden />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <div
              className={cn(
                "mt-1 flex items-center justify-between gap-2 text-xs",
                isSelected ? "text-ink-2" : "text-ink-2/90",
              )}
            >
              <div className="min-w-0 truncate">
                <span className="font-mono font-medium text-ink">{repo.defaultBranch || "main"}</span>
                {repo.totalSizeBytes && formatBytes(repo.totalSizeBytes) && (
                  <span>
                    <span className="text-ink-3"> · </span>
                    <span className="text-ink-2">{formatBytes(repo.totalSizeBytes)}</span>
                  </span>
                )}
                {formatRelativeSyncTime(repo.indexedAt) && (
                  <span>
                    <span className="text-ink-3"> · </span>
                    <span className="text-ink-2">{formatRelativeSyncTime(repo.indexedAt)}</span>
                  </span>
                )}
              </div>
              {status === "failed" && (
                <span className="shrink-0 text-[11px] font-semibold text-danger">Failed</span>
              )}
              {status === "processing" && (
                <span className="shrink-0 text-[11px] font-semibold text-amber-500">Indexing</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
