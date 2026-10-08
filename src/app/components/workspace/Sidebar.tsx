"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { LogOut, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/IconButton";
import { Kbd } from "@/components/ui/Kbd";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { RepoList } from "./RepoList";
import { ConversationList } from "./ConversationList";
import type {
  WorkspaceRepository,
  ConversationThread,
  PlanUsageData,
  ReorderRepositoriesHandler,
  ReorderConversationsHandler,
} from "./types";

interface SidebarProps {
  sessionUser: {
    name: string;
    email: string;
    image?: string | null;
  };
  repositories: WorkspaceRepository[];
  selectedRepo: WorkspaceRepository | null;
  reposLoading?: boolean;
  reposError?: string | null;
  conversations: ConversationThread[];
  selectedConversation: ConversationThread | null;
  convsLoading?: boolean;
  convsError?: string | null;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectRepo: (repo: WorkspaceRepository) => void;
  onDeleteRepo: (repoId: string) => void | Promise<void>;
  onRetryRepo: (repo: WorkspaceRepository) => void | Promise<void>;
  onOpenAddModal: () => void;
  onSelectConversation: (conv: ConversationThread) => void;
  onCreateConversation: () => void | Promise<void>;
  onRenameConversation?: (id: string, newTitle: string) => Promise<void>;
  onDeleteConversation?: (id: string) => Promise<void>;
  onReorderRepositories?: ReorderRepositoriesHandler;
  onReorderConversations?: ReorderConversationsHandler;
  onSignOut: () => void;
  accessMode?: "public" | "full";
  onUpgradeAccess?: () => void;
  planUsage?: PlanUsageData | null;
  onOpenPlanModal?: () => void;
}

function SidebarImpl({
  sessionUser,
  repositories,
  selectedRepo,
  reposLoading,
  reposError,
  conversations,
  selectedConversation,
  convsLoading,
  convsError,
  isMobileOpen,
  onCloseMobile,
  onSelectRepo,
  onDeleteRepo,
  onRetryRepo,
  onOpenAddModal,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
  onReorderRepositories,
  onReorderConversations,
  onSignOut,
  accessMode,
  onUpgradeAccess,
  planUsage: _planUsage,
  onOpenPlanModal,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && isMobileOpen) {
        onCloseMobile();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRepos = normalizedQuery
    ? repositories.filter(
        (repo) =>
          repo.name.toLowerCase().includes(normalizedQuery) ||
          repo.owner.toLowerCase().includes(normalizedQuery),
      )
    : repositories;

  const handleReorderRepositories = useMemo(() => {
    if (!onReorderRepositories) return undefined;
    return (orderedIds: string[]) => {
      const visible = new Set(orderedIds);
      const hidden = repositories
        .filter((repo) => !visible.has(repo.id))
        .map((repo) => repo.id);
      onReorderRepositories([...orderedIds, ...hidden]);
    };
  }, [onReorderRepositories, repositories]);

  const selectRepo = useCallback(
    (repo: WorkspaceRepository) => {
      onSelectRepo(repo);
      onCloseMobile();
    },
    [onCloseMobile, onSelectRepo],
  );

  const selectConversation = useCallback(
    (conv: ConversationThread) => {
      onSelectConversation(conv);
      onCloseMobile();
    },
    [onCloseMobile, onSelectConversation],
  );

  const content = (
    <aside className="flex h-full w-[304px] shrink-0 flex-col border-r border-rail-line bg-rail max-md:w-[325px]">
      <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
        {repositories.length > 0 ? (
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-4"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories"
              aria-label="Search repositories"
              className="w-full rounded-[8px] border border-line bg-surface py-1.5 pr-16 pl-8 text-[13px] tracking-[-0.02em] text-ink transition-colors duration-150 placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            />
            <Kbd letter="K" className="absolute top-1/2 right-2 -translate-y-1/2" />
          </div>
        ) : (
          <span className="min-w-0 flex-1" />
        )}

        <IconButton
          onClick={onOpenAddModal}
          aria-label="Index new repository"
          title="Index new repository"
          className="border border-line bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <Plus className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          onClick={onCloseMobile}
          aria-label="Close sidebar"
          title="Close sidebar"
          className="md:hidden"
        >
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-1 pt-1 pb-3">
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h3 className="text-[11px] font-semibold tracking-wider text-ink-4 uppercase">
            Repositories
          </h3>
          <span className="font-mono text-[11px] text-ink-4">{filteredRepos.length}</span>
        </div>

        <RepoList
          repositories={filteredRepos}
          selectedRepo={selectedRepo}
          isLoading={reposLoading}
          error={reposError}
          onSelectRepo={selectRepo}
          onDeleteRepo={onDeleteRepo}
          onRetryRepo={onRetryRepo}
          onOpenAddModal={onOpenAddModal}
          onReorderRepositories={handleReorderRepositories}
        />

        {selectedRepo && (
          <ConversationList
            conversations={conversations}
            selectedConversation={selectedConversation}
            isLoading={convsLoading}
            error={convsError}
            onSelectConversation={selectConversation}
            onCreateConversation={onCreateConversation}
            onRenameConversation={onRenameConversation}
            onDeleteConversation={onDeleteConversation}
            onReorderConversations={onReorderConversations}
          />
        )}
      </div>

      {onOpenPlanModal && (
        <div className="border-t border-rail-line px-3 py-2">
          <button
            type="button"
            onClick={onOpenPlanModal}
            className="flex w-full items-center justify-between rounded-control px-2 py-1.5 text-[11px] font-semibold text-accent-ink transition-colors duration-150 hover:bg-rail-hover active:scale-[0.98]"
          >
            <span>Plan &amp; usage</span>
            <span className="font-mono text-[10px] text-ink-4">Details →</span>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-rail-line px-3 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {sessionUser.image ? (
            <Image
              src={sessionUser.image}
              alt={sessionUser.name}
              width={32}
              height={32}
              className="shrink-0 rounded-full border border-rail-line object-cover"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2">
              {sessionUser.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-ink">{sessionUser.name}</div>
            <div className="truncate text-[11px] text-ink-4">{sessionUser.email}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge tone={accessMode === "full" ? "accent" : "neutral"}>
                {accessMode === "full" ? "Full Access" : "Public Only"}
              </Badge>
              {accessMode === "public" && onUpgradeAccess && (
                <button
                  type="button"
                  onClick={onUpgradeAccess}
                  title="Upgrade to Full Repository Access"
                  className="rounded-[4px] text-[11px] font-bold text-accent-ink underline transition-colors duration-150 hover:bg-rail-hover"
                >
                  Upgrade
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle className="size-8" />
          <IconButton
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="text-ink-4 hover:bg-rail-hover hover:text-danger"
          >
            <LogOut className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden h-full md:flex">{content}</div>

      {isMobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="fixed inset-0 bg-black/55 backdrop-blur-xs" onClick={onCloseMobile} />
          <div className="relative z-50 flex h-full animate-slide-in-left">{content}</div>
        </div>
      )}
    </>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const Sidebar = memo(SidebarImpl);
