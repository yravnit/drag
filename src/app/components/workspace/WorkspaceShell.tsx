"use client";

import React, { useState } from "react";
import { FolderGit2, Plus, Menu } from "lucide-react";
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
} from "./types";

interface WorkspaceShellProps {
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
  onMessageChange: (text: string) => void;
  onSendMessage: (e: React.FormEvent) => void;
  onCitationClick: (citation: Citation) => void;
  onCloseCitation: () => void;
  onSignOut: () => void;
  onSuggestionClick?: (prompt: string) => void;
  onRetryMessage?: (message: ChatMessage) => void;
  accessMode?: "public" | "full";
  onUpgradeAccess?: () => void;
  planUsage?: PlanUsageData | null;
  isPlanModalOpen?: boolean;
  onOpenPlanModal?: () => void;
  onClosePlanModal?: () => void;
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;
  responseMode?: ResponseMode;
  onResponseModeChange?: (mode: ResponseMode) => void;
}

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
  onMessageChange,
  onSendMessage,
  onCitationClick,
  onCloseCitation,
  onSignOut,
  onSuggestionClick,
  onRetryMessage,
  accessMode,
  onUpgradeAccess,
  planUsage,
  isPlanModalOpen = false,
  onOpenPlanModal,
  onClosePlanModal,
  selectedModel = "default",
  onSelectModel,
  responseMode = "precise",
  onResponseModeChange,
}: WorkspaceShellProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const closeMobileSidebar = React.useCallback(() => setIsMobileSidebarOpen(false), []);
  const toggleMobileSidebar = React.useCallback(
    () => setIsMobileSidebarOpen((prev) => !prev),
    [],
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0a0c] text-zinc-100 font-sans">
      {/* Sidebar Component */}
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
        onSignOut={onSignOut}
        accessMode={accessMode}
        onUpgradeAccess={onUpgradeAccess}
        planUsage={planUsage}
        onOpenPlanModal={onOpenPlanModal}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col bg-[#050507] overflow-hidden relative">
        {!selectedRepo ? (
          /* Empty state: No repository selected */
          <div className="flex-1 flex flex-col">
            {/* Mobile Header Bar */}
            <div className="md:hidden px-4 py-3 border-b border-zinc-900 bg-[#0d0d10]/40 flex items-center gap-3">
              <button
                onClick={() => setIsMobileSidebarOpen(true)}
                className="p-1.5 hover:bg-zinc-800 active:scale-90 rounded-lg text-zinc-400 hover:text-white transition cursor-pointer"
                title="Open menu"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="text-xs font-bold text-white">DRAG Workspace</span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="h-16 w-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow">
                <FolderGit2 className="h-8 w-8 text-zinc-500" />
              </div>
              <h2 className="text-xl font-bold text-white">Select a Repository</h2>
              <p className="mt-2 text-sm text-zinc-400 max-w-sm leading-relaxed">
                Choose a repository from the sidebar or index a new one to start chatting with your codebase.
              </p>
              <button
                onClick={onOpenAddModal}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-95 px-4 py-2.5 text-xs font-bold text-zinc-950 transition shadow cursor-pointer"
              >
                <Plus className="h-4 w-4" /> Index New Repository
              </button>
            </div>
          </div>
        ) : (
          /* Active Selected Repository View */
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
            onRetryMessage={onRetryMessage}
            selectedModel={selectedModel}
            onSelectModel={onSelectModel}
            responseMode={responseMode}
            onResponseModeChange={onResponseModeChange}
          />
        )}
      </main>

      {/* Modal: Add Repository with Entitlement Policy and Privacy Disclosures */}
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

      {/* Modal: Plans and Usage Details */}
      <PlanUsageModal
        isOpen={isPlanModalOpen}
        onClose={onClosePlanModal || (() => {})}
        planUsage={planUsage ?? null}
      />

      {/* Drawer: Citation Detail */}
      <CitationDrawer
        citation={selectedCitation}
        repository={selectedRepo}
        onClose={onCloseCitation}
      />
    </div>
  );
}
