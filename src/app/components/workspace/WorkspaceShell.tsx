"use client";

import React, { useCallback, useState } from "react";
import { FolderGit2, Menu, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { Sidebar } from "./Sidebar";
import { ChatWindow } from "./ChatWindow";
import { AddRepoModal } from "./AddRepoModal";
import { CitationDrawer } from "./CitationDrawer";
import { PlanUsageModal } from "./PlanUsageModal";
import type {
  WorkspaceRepository,
  ConversationThread,
  ChatMessage,
  Citation,
  GithubRepoOption,
  StatusTracker,
  PlanUsageData,
  ResponseMode,
  ReorderRepositoriesHandler,
  ReorderConversationsHandler,
} from "./types";

export interface WorkspaceShellProps {
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
  messages: ChatMessage[];
  messagesLoading?: boolean;
  messagesError?: string | null;
  statusTracker: StatusTracker | null;
  isAddingRepo: boolean;
  githubRepos: GithubRepoOption[];
  githubLoading: boolean;
  repoAddLoading: boolean;
  repoAddError: string;
  messageText: string;
  isStreaming: boolean;
  chatError: string;
  selectedCitation: Citation | null;
  onSelectRepo: (repo: WorkspaceRepository | null) => void;
  onDeleteRepo: (repoId: string) => void | Promise<void>;
  onRetryRepo: (repo: WorkspaceRepository) => void | Promise<void>;
  onOpenAddModal: () => void;
  onCloseAddModal: () => void;
  onAddRepo: (url: string, branch?: string) => Promise<void>;
  onLoadMoreGithub: () => void;
  onSelectConversation: (conv: ConversationThread) => void;
  onCreateConversation: () => void | Promise<void>;
  onRenameConversation?: (id: string, newTitle: string) => Promise<void>;
  onDeleteConversation?: (id: string) => Promise<void>;
  onReorderRepositories?: ReorderRepositoriesHandler;
  onReorderConversations?: ReorderConversationsHandler;
  onMessageChange: (text: string) => void;
  onSendMessage: (e: React.FormEvent) => void;
  onCitationClick: (citation: Citation) => void;
  onCloseCitation: () => void;
  onSignOut: () => void;
  onSuggestionClick?: (prompt: string) => void;
  onEditMessage?: (content: string, messageId?: string) => void;
  onRetryMessage?: (message: ChatMessage) => void;
  onRegenerateMessage?: (message: ChatMessage) => void;
  accessMode?: "public" | "full";
  onUpgradeAccess?: () => void;
  planUsage?: PlanUsageData | null;
  isPlanModalOpen?: boolean;
  onOpenPlanModal?: () => void;
  onClosePlanModal?: () => void;
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;
  manuallyPickedModel?: boolean;
  onManualPickModel?: () => void;
  responseMode?: ResponseMode;
  onResponseModeChange?: (mode: ResponseMode) => void;
}

const DOCKED_DRAWER_COLUMN = "lg:grid-cols-[minmax(0,1fr)_26rem]";

export function WorkspaceShell({
  sessionUser,
  repositories,
  selectedRepo,
  reposLoading,
  reposError,
  conversations,
  selectedConversation,
  convsLoading,
  convsError,
  messages,
  messagesLoading,
  messagesError,
  statusTracker,
  isAddingRepo,
  githubRepos,
  githubLoading,
  repoAddLoading,
  repoAddError,
  messageText,
  isStreaming,
  chatError,
  selectedCitation,
  onSelectRepo,
  onDeleteRepo,
  onRetryRepo,
  onOpenAddModal,
  onCloseAddModal,
  onAddRepo,
  onLoadMoreGithub,
  onSelectConversation,
  onCreateConversation,
  onRenameConversation,
  onDeleteConversation,
  onReorderRepositories,
  onReorderConversations,
  onMessageChange,
  onSendMessage,
  onCitationClick,
  onCloseCitation,
  onSignOut,
  onSuggestionClick,
  onEditMessage,
  onRetryMessage,
  onRegenerateMessage,
  accessMode,
  onUpgradeAccess,
  planUsage,
  isPlanModalOpen = false,
  onOpenPlanModal,
  onClosePlanModal,
  selectedModel = "default",
  onSelectModel,
  manuallyPickedModel,
  onManualPickModel,
  responseMode = "precise",
  onResponseModeChange,
}: WorkspaceShellProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const closeMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);
  const toggleMobileSidebar = useCallback(
    () => setIsMobileSidebarOpen((prev) => !prev),
    [],
  );

  const allCitations = React.useMemo(() => {
    const list: Citation[] = [];
    const seen = new Set<string>();
    for (const msg of messages) {
      if (msg.citations && Array.isArray(msg.citations)) {
        for (const c of msg.citations) {
          const key = `${c.filePath}:${c.startLine}-${c.endLine}`;
          if (!seen.has(key)) {
            seen.add(key);
            list.push(c);
          }
        }
      }
    }
    return list;
  }, [messages]);

  const handleToggleSources = useCallback(() => {
    if (selectedCitation) {
      onCloseCitation();
    } else if (allCitations.length > 0) {
      onCitationClick(allCitations[allCitations.length - 1]);
    } else {
      onCitationClick({
        index: 0,
        filePath: "No sources cited yet",
        startLine: 0,
        endLine: 0,
        symbolName: null,
        text: "",
      });
    }
  }, [selectedCitation, onCloseCitation, allCitations, onCitationClick]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-page text-ink">
      <Sidebar
        sessionUser={sessionUser}
        repositories={repositories}
        selectedRepo={selectedRepo}
        reposLoading={reposLoading}
        reposError={reposError}
        conversations={conversations}
        selectedConversation={selectedConversation}
        convsLoading={convsLoading}
        convsError={convsError}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={closeMobileSidebar}
        onSelectRepo={onSelectRepo}
        onDeleteRepo={onDeleteRepo}
        onRetryRepo={onRetryRepo}
        onOpenAddModal={onOpenAddModal}
        onSelectConversation={onSelectConversation}
        onCreateConversation={onCreateConversation}
        onRenameConversation={onRenameConversation}
        onDeleteConversation={onDeleteConversation}
        onReorderRepositories={onReorderRepositories}
        onReorderConversations={onReorderConversations}
        onSignOut={onSignOut}
        accessMode={accessMode}
        onUpgradeAccess={onUpgradeAccess}
        planUsage={planUsage}
        onOpenPlanModal={onOpenPlanModal}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-header-line bg-header px-3 backdrop-blur-md sm:px-5">
          <IconButton
            onClick={toggleMobileSidebar}
            aria-label="Open sidebar"
            title="Open sidebar"
            className="md:hidden"
          >
            <Menu className="size-4" aria-hidden />
          </IconButton>

          <span className="shrink-0 font-brand text-[17px] leading-none text-ink">DRAG</span>

          {selectedConversation && (
            <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
              <span className="text-sm text-ink-4" aria-hidden>
                /
              </span>
              <span
                title={selectedConversation.title}
                className="truncate text-[13px] font-medium text-ink-3"
              >
                {selectedConversation.title}
              </span>
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleToggleSources}
              aria-pressed={selectedCitation !== null}
              title={
                selectedCitation
                  ? "Hide source citations"
                  : "View source citations"
              }
              className={cn(
                "inline-flex h-[34px] items-center gap-1.5 rounded-[8px] border px-3 text-[12.5px] font-semibold transition-colors duration-150 active:scale-[0.96]",
                selectedCitation !== null
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "border-line bg-surface-2 text-ink-2 hover:border-line-2 hover:bg-surface-3 hover:text-ink",
              )}
            >
              <span>{selectedCitation ? "Hide Sources" : "Sources"}</span>
              {allCitations.length > 0 && (
                <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                  {allCitations.length}
                </span>
              )}
            </button>
          </div>
        </header>

        <div
          className={cn(
            "grid min-h-0 flex-1 auto-rows-fr grid-cols-1",
            selectedCitation && DOCKED_DRAWER_COLUMN,
          )}
        >
          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-chat">
            {!selectedRepo ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
                <div className="flex size-16 items-center justify-center rounded-card border border-line bg-surface text-accent shadow-card">
                  <FolderGit2 className="size-8" aria-hidden />
                </div>
                <div className="max-w-sm">
                  <h2 className="text-2xl font-display tracking-display text-ink">
                    Select a Repository
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">
                    Choose a repository from the sidebar or index a new one to start
                    chatting with your codebase.
                  </p>
                </div>
                <Button onClick={onOpenAddModal}>
                  <Plus className="size-4" aria-hidden />
                  Index New Repository
                </Button>
              </div>
            ) : (
              <ChatWindow
                selectedRepo={selectedRepo}
                selectedConversation={selectedConversation}
                statusTracker={statusTracker}
                messages={messages}
                messagesLoading={messagesLoading}
                messagesError={messagesError}
                messageText={messageText}
                isStreaming={isStreaming}
                chatError={chatError}
                onMessageChange={onMessageChange}
                onSendMessage={onSendMessage}
                onCitationClick={onCitationClick}
                onCreateConversation={onCreateConversation}
                onRetryRepo={onRetryRepo}
                onToggleMobileSidebar={toggleMobileSidebar}
                onSuggestionClick={onSuggestionClick}
                onEditMessage={onEditMessage}
                onRetryMessage={onRetryMessage}
                onRegenerateMessage={onRegenerateMessage}
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
                manuallyPickedModel={manuallyPickedModel}
                onManualPickModel={onManualPickModel}
                responseMode={responseMode}
                onResponseModeChange={onResponseModeChange}
              />
            )}
          </main>

          <CitationDrawer
            citation={selectedCitation}
            repository={selectedRepo}
            onClose={onCloseCitation}
            allCitations={allCitations}
            onSelectCitation={onCitationClick}
          />
        </div>
      </div>

      <AddRepoModal
        isOpen={isAddingRepo}
        onClose={onCloseAddModal}
        onAddRepo={onAddRepo}
        githubRepos={githubRepos}
        githubLoading={githubLoading}
        onLoadMoreGithub={onLoadMoreGithub}
        repoAddLoading={repoAddLoading}
        repoAddError={repoAddError}
        accessMode={accessMode}
        onUpgradeAccess={onUpgradeAccess}
        entitlements={planUsage?.entitlements}
      />

      <PlanUsageModal
        isOpen={isPlanModalOpen}
        onClose={onClosePlanModal || (() => {})}
        planUsage={planUsage ?? null}
      />
    </div>
  );
}
