import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationList } from "../ConversationList";
import { ChatWindow } from "../ChatWindow";
import { Composer } from "../Composer";
import { CitationDrawer } from "../CitationDrawer";
import { RepoList } from "../RepoList";
import { formatBytes, formatRelativeSyncTime } from "../formatters";
import type {
  WorkspaceRepository,
  ConversationThread,
  Citation,
  StatusTracker,
} from "../types";

describe("Workspace UX Completion - Phase 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Conversation Search in ConversationList", () => {
    const mockConversations: ConversationThread[] = [
      { id: "c1", repositoryId: "r1", title: "Authentication architecture" },
      { id: "c2", repositoryId: "r1", title: "Database migrations and schema" },
      { id: "c3", repositoryId: "r1", title: "RAG retrieval benchmark" },
    ];

    it("renders search input placeholder and all conversation threads", () => {
      const html = renderToStaticMarkup(
        <ConversationList
          conversations={mockConversations}
          selectedConversation={null}
          onSelectConversation={vi.fn()}
          onCreateConversation={vi.fn()}
        />,
      );

      expect(html).toContain("Search chats...");
      expect(html).toContain("Authentication architecture");
      expect(html).toContain("Database migrations and schema");
      expect(html).toContain("RAG retrieval benchmark");
    });

    it("renders empty thread notice when conversation list is empty", () => {
      const html = renderToStaticMarkup(
        <ConversationList
          conversations={[]}
          selectedConversation={null}
          onSelectConversation={vi.fn()}
          onCreateConversation={vi.fn()}
        />,
      );

      expect(html).toContain("No active threads.");
    });
  });

  describe("2. Dynamic Ingestion Progress in ChatWindow", () => {
    const baseRepo: WorkspaceRepository = {
      id: "repo-1",
      githubId: "12345",
      name: "drag",
      owner: "developer",
      url: "https://github.com/developer/drag",
      defaultBranch: "main",
      description: "AI repo assistant",
      primaryLanguage: "TypeScript",
      indexedAt: null,
      embeddingStatus: "processing",
      createdAt: new Date().toISOString(),
    };

    it("renders 'Preparing Repository' state when stage is preparing", () => {
      const statusTracker: StatusTracker = {
        id: "repo-1",
        embeddingStatus: "processing",
        stage: "preparing",
        indexedAt: null,
        filesIndexed: 0,
        chunksCount: 0,
      };

      const html = renderToStaticMarkup(
        <ChatWindow
          selectedRepo={baseRepo}
          selectedConversation={null}
          statusTracker={statusTracker}
          messages={[]}
          messageText=""
          isStreaming={false}
          chatError=""
          onMessageChange={vi.fn()}
          onSendMessage={vi.fn()}
          onCitationClick={vi.fn()}
          onCreateConversation={vi.fn()}
          onRetryRepo={vi.fn()}
          onToggleMobileSidebar={vi.fn()}
        />,
      );

      expect(html).toContain("Preparing Repository");
      expect(html).toContain("Acquiring repository files and verifying size limits.");
    });

    it("renders 'Indexing Repository' state when stage is indexing with files discovered", () => {
      const statusTracker: StatusTracker = {
        id: "repo-1",
        embeddingStatus: "processing",
        stage: "indexing",
        indexedAt: null,
        filesIndexed: 42,
        chunksCount: 0,
      };

      const html = renderToStaticMarkup(
        <ChatWindow
          selectedRepo={baseRepo}
          selectedConversation={null}
          statusTracker={statusTracker}
          messages={[]}
          messageText=""
          isStreaming={false}
          chatError=""
          onMessageChange={vi.fn()}
          onSendMessage={vi.fn()}
          onCitationClick={vi.fn()}
          onCreateConversation={vi.fn()}
          onRetryRepo={vi.fn()}
          onToggleMobileSidebar={vi.fn()}
        />,
      );

      expect(html).toContain("Indexing Repository");
      expect(html).toContain("42 files discovered");
    });

    it("renders 'Embedding Codebase' state with chunk counts when stage is embedding", () => {
      const statusTracker: StatusTracker = {
        id: "repo-1",
        embeddingStatus: "processing",
        stage: "embedding",
        indexedAt: null,
        filesIndexed: 42,
        chunksCount: 150,
        embeddedChunksCount: 50,
      };

      const html = renderToStaticMarkup(
        <ChatWindow
          selectedRepo={baseRepo}
          selectedConversation={null}
          statusTracker={statusTracker}
          messages={[]}
          messageText=""
          isStreaming={false}
          chatError=""
          onMessageChange={vi.fn()}
          onSendMessage={vi.fn()}
          onCitationClick={vi.fn()}
          onCreateConversation={vi.fn()}
          onRetryRepo={vi.fn()}
          onToggleMobileSidebar={vi.fn()}
        />,
      );

      expect(html).toContain("Embedding Codebase");
      expect(html).toContain("50 / 150 chunks");
    });

    it("renders 'Repository Ready' state when embeddingStatus is ready", () => {
      const statusTracker: StatusTracker = {
        id: "repo-1",
        embeddingStatus: "ready",
        stage: "ready",
        indexedAt: new Date().toISOString(),
        filesIndexed: 42,
        chunksCount: 150,
        totalSizeBytes: 1048576, // 1 MB
      };

      const html = renderToStaticMarkup(
        <ChatWindow
          selectedRepo={baseRepo}
          selectedConversation={null}
          statusTracker={statusTracker}
          messages={[]}
          messageText=""
          isStreaming={false}
          chatError=""
          onMessageChange={vi.fn()}
          onSendMessage={vi.fn()}
          onCitationClick={vi.fn()}
          onCreateConversation={vi.fn()}
          onRetryRepo={vi.fn()}
          onToggleMobileSidebar={vi.fn()}
        />,
      );

      expect(html).toContain("Repository Ready");
      expect(html).toContain("1.0 MB");
      expect(html).toContain("42 files indexed");
    });

    it("renders 'Repository Indexing Failed' with retry button when stage is failed", () => {
      const statusTracker: StatusTracker = {
        id: "repo-1",
        embeddingStatus: "failed",
        stage: "failed",
        indexedAt: null,
      };

      const html = renderToStaticMarkup(
        <ChatWindow
          selectedRepo={baseRepo}
          selectedConversation={null}
          statusTracker={statusTracker}
          messages={[]}
          messageText=""
          isStreaming={false}
          chatError=""
          onMessageChange={vi.fn()}
          onSendMessage={vi.fn()}
          onCitationClick={vi.fn()}
          onCreateConversation={vi.fn()}
          onRetryRepo={vi.fn()}
          onToggleMobileSidebar={vi.fn()}
        />,
      );

      expect(html).toContain("Repository Indexing Failed");
      expect(html).toContain("Retry / Re-index Repository");
    });
  });

  describe("3. Repository Storage & Relative Sync Formatter", () => {
    it("formats bytes accurately across units", () => {
      expect(formatBytes(null)).toBeNull();
      expect(formatBytes(undefined)).toBeNull();
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
    });

    it("formats relative sync time accurately", () => {
      expect(formatRelativeSyncTime(null)).toBeNull();
      expect(formatRelativeSyncTime(undefined)).toBeNull();

      const now = Date.now();
      expect(formatRelativeSyncTime(new Date(now - 10 * 1000))).toBe("Synced just now");
      expect(formatRelativeSyncTime(new Date(now - 2 * 60 * 1000))).toBe("Synced 2 minutes ago");
      expect(formatRelativeSyncTime(new Date(now - 2 * 60 * 60 * 1000))).toBe("Synced 2 hours ago");
      expect(formatRelativeSyncTime(new Date(now - 28 * 60 * 60 * 1000))).toBe("Synced yesterday");
      expect(formatRelativeSyncTime(new Date(now - 4 * 24 * 60 * 60 * 1000))).toBe("Synced 4 days ago");
    });

    it("displays storage and relative sync timestamp in RepoList", () => {
      const testRepo: WorkspaceRepository = {
        id: "r1",
        githubId: "1",
        name: "test-repo",
        owner: "user",
        url: "https://github.com/user/test-repo",
        defaultBranch: "main",
        description: null,
        primaryLanguage: "TypeScript",
        indexedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        embeddingStatus: "ready",
        totalSizeBytes: 204800, // 200 KB
        createdAt: new Date().toISOString(),
      };

      const html = renderToStaticMarkup(
        <RepoList
          repositories={[testRepo]}
          selectedRepo={null}
          onSelectRepo={vi.fn()}
          onDeleteRepo={vi.fn()}
          onRetryRepo={vi.fn()}
          onOpenAddModal={vi.fn()}
        />,
      );

      expect(html).toContain("200.0 KB");
      expect(html).toContain("Synced 1 hour ago");
    });
  });

  describe("4. Conversation Response Modes in Composer", () => {
    it("does not render response mode buttons or tools in Composer", () => {
      const html = renderToStaticMarkup(
        <Composer
          messageText=""
          isStreaming={false}
          chatError=""
          responseMode="detailed"
          onResponseModeChange={vi.fn()}
          onMessageChange={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );

      expect(html).not.toContain("Concise");
      expect(html).not.toContain("Deep");
      expect(html).not.toContain("Simple");
      expect(html).not.toContain("+ Tools");
    });
  });

  describe("5. Citation File Download in CitationDrawer", () => {
    const mockCitation: Citation = {
      index: 1,
      filePath: "src/auth/server.ts",
      startLine: 1,
      endLine: 20,
      symbolName: "auth",
      text: "export const auth = createAuth();",
    };

    const mockRepo: WorkspaceRepository = {
      id: "repo-1",
      githubId: "1",
      name: "drag",
      owner: "user",
      url: "https://github.com/user/drag",
      defaultBranch: "main",
      description: null,
      primaryLanguage: "TypeScript",
      indexedAt: null,
      embeddingStatus: "ready",
      createdAt: new Date().toISOString(),
    };

    it("renders download button in CitationDrawer", () => {
      const html = renderToStaticMarkup(
        <CitationDrawer
          citation={mockCitation}
          repository={mockRepo}
          onClose={vi.fn()}
        />,
      );

      expect(html).toContain("Download file");
      expect(html).toContain("Copy code");
      expect(html).toContain("server.ts");
    });
  });
});
