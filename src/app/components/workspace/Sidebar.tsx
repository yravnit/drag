"use client";

import React, { memo, useState, useRef, useEffect } from "react";
import Image from "next/image";
import { FolderGit2, Plus, LogOut, X, Search } from "lucide-react";
import { RepoList } from "./RepoList";
import { ConversationList } from "./ConversationList";
import { formatLimit } from "./formatters";
import type { WorkspaceRepository, ConversationThread, PlanUsageData } from "./types";

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
  onSignOut,
  accessMode,
  onUpgradeAccess,
  planUsage,
  onOpenPlanModal,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl/Cmd + K shortcut for repository filter
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

  // Filter repositories by search query
  const filteredRepos = searchQuery.trim()
    ? repositories.filter(
        (r) =>
          r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.owner.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : repositories;

  const content = (
    <aside className="w-80 h-full border-r border-zinc-900 bg-[#0d0d10] flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-zinc-900 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 shadow shadow-teal-500/10">
            <FolderGit2 className="h-5 w-5 text-teal-400" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-wide text-white">DRAG Workspace</span>
            <div className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">v1.1 · Beta</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onOpenAddModal}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 hover:bg-zinc-800 active:scale-90 border border-zinc-800 hover:border-zinc-600 transition cursor-pointer text-zinc-300"
            title="Index new repository"
          >
            <Plus className="h-4 w-4" />
          </button>
          {/* Mobile close button */}
          <button
            onClick={onCloseMobile}
            className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg hover:bg-zinc-800 active:scale-90 text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
            title="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Lists Scroll Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Repositories section */}
        <div>
          <div className="px-2 flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
              Repositories
            </h3>
            <span className="text-[11px] text-zinc-400 font-mono">
              {filteredRepos.length}
            </span>
          </div>

          {/* Repository search filter with Cmd+K badge */}
          {repositories.length > 0 && (
            <div className="relative mb-2 px-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter repositories..."
                className="w-full pl-8 pr-12 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 transition"
              />
              <kbd className="absolute right-3 top-2 px-1.5 py-0.5 rounded text-[9px] font-mono bg-zinc-850 text-zinc-500 border border-zinc-750 select-none">
                ⌘K
              </kbd>
            </div>
          )}

          <div className="mt-1">
            <RepoList
              repositories={filteredRepos}
              selectedRepo={selectedRepo}
              isLoading={reposLoading}
              error={reposError}
              onSelectRepo={(repo) => {
                onSelectRepo(repo);
                onCloseMobile();
              }}
              onDeleteRepo={onDeleteRepo}
              onRetryRepo={onRetryRepo}
              onOpenAddModal={onOpenAddModal}
            />
          </div>
        </div>

        {/* Conversations section (visible when a repo is selected) */}
        {selectedRepo && (
          <ConversationList
            conversations={conversations}
            selectedConversation={selectedConversation}
            isLoading={convsLoading}
            error={convsError}
            onSelectConversation={(conv) => {
              onSelectConversation(conv);
              onCloseMobile();
            }}
            onCreateConversation={onCreateConversation}
            onRenameConversation={onRenameConversation}
            onDeleteConversation={onDeleteConversation}
          />
        )}
      </div>

      {/* Plan & Usage Section */}
      {planUsage && (
        <div className="p-3 border-t border-zinc-900 bg-zinc-950/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                Plan:
              </span>
              <span className="text-xs font-bold text-white capitalize">
                {planUsage.plan}
              </span>
              <span className="text-[11px] text-zinc-400 font-mono">
                {planUsage.pricing.displayPrice}
              </span>
            </div>
            {onOpenPlanModal && (
              <button
                type="button"
                onClick={onOpenPlanModal}
                className="rounded px-1 py-0.5 text-[10px] text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 active:scale-95 font-medium transition cursor-pointer"
              >
                View
              </button>
            )}
          </div>

          {/* Usage metrics */}
          <div className="space-y-1.5 text-[11px] text-zinc-400">
            <div className="flex items-center justify-between">
              <span>Repositories</span>
              <span className="font-mono text-zinc-200">
                {planUsage.usage.repositoriesCount} / {formatLimit(planUsage.entitlements.repositoryLimit)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>RAG queries</span>
              <span className="font-mono text-zinc-200">
                {planUsage.usage.monthlyQueriesCount}
                {planUsage.entitlements.monthlyQueryLimit !== null
                  ? ` / ${formatLimit(planUsage.entitlements.monthlyQueryLimit)} this month`
                  : " this month (unmetered)"}
              </span>
            </div>
          </div>

          {/* Upgrade prompt for Free users only */}
          {planUsage.plan === "free" && onOpenPlanModal && (
            <button
              type="button"
              onClick={onOpenPlanModal}
              className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 active:scale-[0.98] border border-teal-500/30 text-[11px] font-bold text-teal-300 transition cursor-pointer"
            >
              <span>Upgrade to Hobby</span>
              <span className="text-[9px] text-teal-400 font-mono">₹499/mo</span>
            </button>
          )}
        </div>
      )}

      {/* Footer Profile Info */}
      <div className="p-4 border-t border-zinc-900 bg-zinc-950/40 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          {sessionUser.image ? (
            <Image
              src={sessionUser.image}
              alt={sessionUser.name}
              width={32}
              height={32}
              className="rounded-full object-cover shrink-0 border border-zinc-800"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300 shrink-0">
              {sessionUser.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate text-zinc-200">{sessionUser.name}</div>
            <div className="text-[11px] text-zinc-400 truncate">{sessionUser.email}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                  accessMode === "full"
                    ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                }`}
              >
                {accessMode === "full" ? "Full Access" : "Public Only"}
              </span>
              {accessMode === "public" && onUpgradeAccess && (
                <button
                  type="button"
                  onClick={onUpgradeAccess}
                  className="rounded px-0.5 text-[9px] font-bold text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 underline transition cursor-pointer"
                  title="Upgrade to Full Repository Access"
                >
                  Upgrade
                </button>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="p-2 text-zinc-500 hover:text-red-400 rounded-lg transition hover:bg-zinc-900/50 active:scale-90 cursor-pointer"
          title="Sign Out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <div className="hidden md:flex h-full">{content}</div>

      {/* Mobile Drawer with Backdrop */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative z-50 h-full flex animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const Sidebar = memo(SidebarImpl);
