"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  Check,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConversationThread, ReorderConversationsHandler } from "./types";

type DropPosition = "top" | "bottom";

export interface ConversationListProps {
  conversations: ConversationThread[];
  selectedConversation: ConversationThread | null;
  isLoading?: boolean;
  error?: string | null;
  onSelectConversation: (conv: ConversationThread) => void;
  onCreateConversation: () => void | Promise<void>;
  onRenameConversation?: (id: string, newTitle: string) => Promise<void>;
  onDeleteConversation?: (id: string) => Promise<void>;
  onReorderConversations?: ReorderConversationsHandler;
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

export function ConversationList({
  conversations,
  selectedConversation,
  isLoading,
  error,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
  onReorderConversations,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(
    null,
  );

  const repositoryId = conversations[0]?.repositoryId ?? "";
  const canReorder = Boolean(onReorderConversations) && repositoryId !== "";

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setActionError("");
    try {
      await onCreateConversation();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start a new chat.");
    } finally {
      setCreating(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredConversations = normalizedQuery
    ? conversations.filter((conv) => conv.title.toLowerCase().includes(normalizedQuery))
    : conversations;

  const startRename = (conv: ConversationThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleSaveRename = async (id: string, e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editingTitle.trim() || !onRenameConversation) {
      setEditingId(null);
      return;
    }
    setActionLoading(true);
    try {
      await onRenameConversation(id, editingTitle.trim());
      setEditingId(null);
    } catch (err) {
      console.error("Failed to rename conversation:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteId || !onDeleteConversation) return;
    setDeleting(true);
    setActionError("");
    try {
      await onDeleteConversation(pendingDeleteId);
      setPendingDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete this chat.");
    } finally {
      setDeleting(false);
    }
  };

  const pendingDeleteTitle = conversations.find((c) => c.id === pendingDeleteId)?.title;

  const commitOrder = (ordered: ConversationThread[]) => {
    if (!onReorderConversations || repositoryId === "") return;
    onReorderConversations(
      repositoryId,
      ordered.map((conv) => conv.id),
    );
  };

  const nudge = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= filteredConversations.length) return;
    const ordered = [...filteredConversations];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    commitOrder(ordered);
  };

  const clearDrag = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-ink-4 uppercase">Chats</h3>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="flex cursor-pointer items-center gap-0.5 rounded-control px-1.5 py-0.5 text-[11px] font-semibold text-accent-ink transition-colors duration-150 hover:bg-rail-hover disabled:opacity-60"
          title="Start new conversation"
        >
          {creating ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-3" aria-hidden />
          )}
          New
        </button>
      </div>

      {actionError && (
        <div className="mx-2 mt-2 flex items-start gap-1.5 rounded-control border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {conversations.length > 0 && (
        <div className="relative mt-2 px-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-3 -translate-y-1/2 text-ink-4"
            aria-hidden
          />
          <input
            type="text"
            placeholder="Search chats..."
            aria-label="Search chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[8px] border border-line bg-surface py-1.5 pr-7 pl-7 text-xs text-ink transition-colors duration-150 placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear chat search"
              className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded-[4px] p-0.5 text-ink-4 transition-colors duration-150 hover:text-ink"
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </div>
      )}

      <div className="mt-2 space-y-0.5">
        {error && conversations.length > 0 && (
          <div className="mx-2 mb-1 flex items-start gap-1.5 rounded-[4px] border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
            <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {isLoading && conversations.length === 0 ? (
          <div className="py-3 text-center">
            <Loader2 className="mx-auto size-4 animate-spin text-ink-4" aria-hidden />
          </div>
        ) : error && conversations.length === 0 ? (
          <div className="flex items-center justify-center gap-1 p-2 text-center text-xs text-danger">
            <AlertCircle className="size-3 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-2 text-xs text-ink-4">No active threads.</p>
        ) : filteredConversations.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-ink-4">
            No chats match &quot;{searchQuery}&quot;
          </p>
        ) : (
          filteredConversations.map((conv, index) => {
            const isSelected = selectedConversation?.id === conv.id;
            const isEditing = editingId === conv.id;
            const isDragging = draggedId === conv.id;
            const isDropTop = dropTarget?.id === conv.id && dropTarget.position === "top";
            const isDropBottom = dropTarget?.id === conv.id && dropTarget.position === "bottom";

            if (isEditing) {
              return (
                <form
                  key={conv.id}
                  onSubmit={(e) => handleSaveRename(conv.id, e)}
                  className="flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-1.5"
                >
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    autoFocus
                    maxLength={100}
                    disabled={actionLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    aria-label="Thread title"
                    className="flex-1 rounded-[4px] border border-line bg-surface-2 px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={actionLoading || !editingTitle.trim()}
                    aria-label="Save title"
                    title="Save title"
                    className="cursor-pointer rounded-[4px] p-1 text-accent-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-50"
                  >
                    <Check className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={actionLoading}
                    aria-label="Cancel rename"
                    title="Cancel"
                    className="cursor-pointer rounded-[4px] p-1 text-ink-4 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:opacity-50"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </form>
              );
            }

            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                aria-current={isSelected}
                draggable={canReorder}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.setData("text/plain", conv.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDraggedId(conv.id);
                }}
                onDragEnd={clearDrag}
                onDragOver={(event) => {
                  if (!draggedId || draggedId === conv.id) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setDropTarget({
                    id: conv.id,
                    position:
                      event.clientY - bounds.top < bounds.height / 2 ? "top" : "bottom",
                  });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropTarget((prev) => (prev?.id === conv.id ? null : prev));
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggedId && dropTarget && draggedId !== conv.id) {
                    commitOrder(
                      moveItem(filteredConversations, draggedId, conv.id, dropTarget.position),
                    );
                  }
                  clearDrag();
                }}
                onClick={() => onSelectConversation(conv)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectConversation(conv);
                  }
                }}
                className={cn(
                  "group relative flex cursor-pointer items-center justify-between gap-1 rounded-control border border-transparent px-2 py-1.5 transition-[background-color,color,border-color] duration-150 active:scale-[0.99]",
                  isSelected
                    ? "bg-rail-active font-semibold text-rail-active-ink"
                    : "text-ink-3 hover:bg-rail-hover hover:text-ink",
                  isDragging && "bg-rail-hover opacity-40",
                )}
              >
                {isDropTop && <DropIndicator position="top" />}
                {isDropBottom && <DropIndicator position="bottom" />}

                <div className="flex min-w-0 items-center gap-1.5">
                  {canReorder && (
                    <button
                      type="button"
                      draggable={false}
                      tabIndex={0}
                      aria-label={`Reorder ${conv.title}. Press the up or down arrow key to move it.`}
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
                      <GripVertical className="size-3" aria-hidden />
                    </button>
                  )}
                  <span className="truncate text-[13px] tracking-[-0.02em]">{conv.title}</span>
                </div>

                <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-150 focus-within:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {onRenameConversation && (
                    <button
                      type="button"
                      onClick={(event) => startRename(conv, event)}
                      title="Rename conversation"
                      aria-label={`Rename ${conv.title}`}
                      className="cursor-pointer rounded-[4px] p-0.5 text-ink-4 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                    >
                      <Pencil className="size-3" aria-hidden />
                    </button>
                  )}
                  {onDeleteConversation && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActionError("");
                        setPendingDeleteId(conv.id);
                      }}
                      title="Delete conversation"
                      aria-label={`Delete ${conv.title}`}
                      className="cursor-pointer rounded-[4px] p-0.5 text-ink-4 transition-colors duration-150 hover:bg-surface-2 hover:text-danger"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="Delete chat thread?"
        message={`"${pendingDeleteTitle ?? "This thread"}" and all of its messages will be permanently removed. This cannot be undone.`}
        pending={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
