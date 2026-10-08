"use client";

import React, { useState } from "react";
import { MessageSquare, Plus, Loader2, AlertCircle, Pencil, Trash2, Check, X, Search } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConversationThread } from "./types";

interface ConversationListProps {
  conversations: ConversationThread[];
  selectedConversation: ConversationThread | null;
  isLoading?: boolean;
  error?: string | null;
  onSelectConversation: (conv: ConversationThread) => void;
  onCreateConversation: () => void | Promise<void>;
  onRenameConversation?: (id: string, newTitle: string) => Promise<void>;
  onDeleteConversation?: (id: string) => Promise<void>;
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
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");

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

  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase().trim()),
      )
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

  return (
    <div>
      <div className="px-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Chats</h3>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-0.5 rounded px-1 text-xs font-semibold text-teal-400 transition hover:text-teal-300 hover:bg-teal-500/10 active:scale-95 disabled:opacity-60 cursor-pointer"
          title="Start new conversation"
        >
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          New
        </button>
      </div>

      {actionError && (
        <div className="mx-2 mt-2 flex items-start gap-1.5 rounded-lg border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-[11px] text-red-400">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {conversations.length > 0 && (
        <div className="px-2 mt-2">
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3 w-3 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/60 border border-zinc-800 text-[11px] text-zinc-200 placeholder-zinc-500 rounded-lg pl-7 pr-6 py-1.5 focus:outline-none focus:border-zinc-700 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 p-0.5 text-zinc-500 hover:text-zinc-300 rounded cursor-pointer"
                title="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 space-y-1">
        {isLoading && conversations.length === 0 ? (
          <div className="py-3 text-center">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-500 mx-auto" />
          </div>
        ) : error ? (
          <div className="p-2 text-center text-xs text-red-400 flex items-center justify-center gap-1">
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-2 text-xs text-zinc-600">No active threads.</p>
        ) : filteredConversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-zinc-500 text-center">No chats match &quot;{searchQuery}&quot;</p>
        ) : (
          filteredConversations.map((conv) => {
            const isSelected = selectedConversation?.id === conv.id;
            const isEditing = editingId === conv.id;

            if (isEditing) {
              return (
                <form
                  key={conv.id}
                  onSubmit={(e) => handleSaveRename(conv.id, e)}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800"
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
                    className="flex-1 bg-zinc-950 text-xs text-white px-2 py-1 rounded border border-zinc-750 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={actionLoading || !editingTitle.trim()}
                    className="p-1 hover:bg-zinc-800 text-teal-400 rounded cursor-pointer"
                    title="Save title"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    disabled={actionLoading}
                    className="p-1 hover:bg-zinc-800 text-zinc-400 rounded cursor-pointer"
                    title="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              );
            }

            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(conv)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectConversation(conv);
                  }
                }}
                aria-current={isSelected}
                className={`group flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${
                  isSelected
                    ? "border-teal-500/50 bg-teal-500/10 text-white font-semibold shadow-xs"
                    : "border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare
                    className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-teal-400" : ""}`}
                  />
                  <span className="truncate max-w-[170px]">{conv.title}</span>
                </div>

                <div className="flex items-center gap-1 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 shrink-0">
                  {onRenameConversation && (
                    <button
                      onClick={(e) => startRename(conv, e)}
                      title="Rename conversation"
                      aria-label={`Rename ${conv.title}`}
                      className="p-1 rounded transition cursor-pointer text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 active:scale-90"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {onDeleteConversation && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionError("");
                        setPendingDeleteId(conv.id);
                      }}
                      title="Delete conversation"
                      aria-label={`Delete ${conv.title}`}
                      className="p-1 rounded transition cursor-pointer text-zinc-500 hover:bg-zinc-800 hover:text-red-400 active:scale-90"
                    >
                      <Trash2 className="h-3 w-3" />
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
