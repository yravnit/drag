import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageRenderer } from "../MessageRenderer";
import { CitationDrawer } from "../CitationDrawer";
import { RepoList } from "../RepoList";
import { ConversationList } from "../ConversationList";
import { MessageBubble } from "../MessageBubble";
import { ChatWindow } from "../ChatWindow";
import { Sidebar } from "../Sidebar";
import { Composer } from "../Composer";
import type { Citation, WorkspaceRepository, ConversationThread } from "../types";

/**
 * Text content of the rendered `<pre>` code surface.
 *
 * The code surface is split into per-line spans with per-token spans inside them, so no single
 * text node holds the snippet. Stripping tags and decoding entities asserts the same thing the
 * old single-text-node assertion did — the snippet reaches the user intact — without pinning the
 * tokenizer's DOM shape.
 */
const codeSurfaceText = (html: string) => {
  const pre = /<pre[\s\S]*?<\/pre>/.exec(html)?.[0] ?? "";
  return pre
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
};

describe("MessageRenderer Component", () => {
  it("renders Markdown headings, paragraphs, and lists", () => {
    const markdown = `# Main Title\n\nThis is a paragraph.\n\n* Item 1\n* Item 2`;
    const html = renderToStaticMarkup(
      <MessageRenderer content={markdown} onCitationClick={vi.fn()} />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Main Title");
    expect(html).toContain("<p");
    expect(html).toContain("This is a paragraph.");
    expect(html).toContain("<ul");
    expect(html).toContain("Item 1");
    expect(html).toContain("Item 2");
  });

  it("renders code blocks with language indicators and copy button", () => {
    const markdown = "```typescript\nconst greeting = 'hello';\n```";
    const html = renderToStaticMarkup(
      <MessageRenderer content={markdown} onCitationClick={vi.fn()} />,
    );

    expect(html).toContain("typescript");
    expect(codeSurfaceText(html)).toContain("const greeting = 'hello';");
    expect(html).toContain("Copy");
  });

  it("renders inline citations as interactive buttons", () => {
    const markdown = "Refer to the filter implementation [1] for security logic.";
    const citations: Citation[] = [
      {
        index: 1,
        filePath: "src/lib/ingestion/fileFilter.ts",
        startLine: 10,
        endLine: 25,
        symbolName: "isSensitiveFile",
        text: "export function isSensitiveFile() {}",
      },
    ];

    const html = renderToStaticMarkup(
      <MessageRenderer content={markdown} citations={citations} onCitationClick={vi.fn()} />,
    );

    expect(html).toContain("<button");
    expect(html).toContain("[1]");
    expect(html).toContain("View citation [1]: src/lib/ingestion/fileFilter.ts");
  });
});

describe("CitationDrawer Component", () => {
  const sampleCitation: Citation = {
    index: 1,
    filePath: "src/lib/leases/repositoryLeases.ts",
    startLine: 15,
    endLine: 30,
    symbolName: "claimEmbeddingLease",
    text: "export async function claimEmbeddingLease() {\n  return true;\n}",
  };

  const sampleRepo: WorkspaceRepository = {
    id: "repo-1",
    githubId: "123456",
    name: "drag",
    owner: "octocat",
    url: "https://github.com/octocat/drag",
    defaultBranch: "main",
    description: "AI repo assistant",
    primaryLanguage: "TypeScript",
    indexedAt: new Date().toISOString(),
    embeddingStatus: "ready",
    createdAt: new Date().toISOString(),
  };

  it("renders file path, line numbers, and symbol name", () => {
    const html = renderToStaticMarkup(
      <CitationDrawer citation={sampleCitation} repository={sampleRepo} onClose={vi.fn()} />,
    );

    expect(html).toContain("repositoryLeases.ts");
    expect(html).toContain("Lines 15 - 30");
    expect(html).toContain("claimEmbeddingLease");
    expect(html).toContain("src/lib/leases/repositoryLeases.ts");
  });

  it("generates an accurate GitHub link for line ranges", () => {
    const html = renderToStaticMarkup(
      <CitationDrawer citation={sampleCitation} repository={sampleRepo} onClose={vi.fn()} />,
    );

    expect(html).toContain(
      "https://github.com/octocat/drag/blob/main/src/lib/leases/repositoryLeases.ts#L15-L30",
    );
    expect(html).toContain("Open on GitHub");
  });

  it("returns null when citation is null", () => {
    const html = renderToStaticMarkup(
      <CitationDrawer citation={null} repository={sampleRepo} onClose={vi.fn()} />,
    );

    expect(html).toBe("");
  });

  it("renders clear notice when snippet text is empty", () => {
    const emptyCitation: Citation = {
      ...sampleCitation,
      text: "",
    };
    const html = renderToStaticMarkup(
      <CitationDrawer citation={emptyCitation} repository={null} onClose={vi.fn()} />,
    );

    expect(html).toContain("Snippet content unavailable for this citation");
    expect(html).toContain("Source unavailable");
  });

  it("renders clean empty state notice for placeholder citation", () => {
    const placeholderCitation: Citation = {
      index: 0,
      filePath: "No sources cited yet",
      startLine: 0,
      endLine: 0,
      symbolName: null,
      text: "",
    };
    const html = renderToStaticMarkup(
      <CitationDrawer citation={placeholderCitation} repository={null} onClose={vi.fn()} />,
    );

    expect(html).toContain("No sources cited yet");
    expect(html).toContain("When the assistant references code");
    expect(html).not.toContain("Lines 0 - 0");
  });

  it("renders cited source pills when allCitations has multiple items", () => {
    const secondCitation: Citation = {
      index: 2,
      filePath: "src/lib/retrieval/retriever.ts",
      startLine: 50,
      endLine: 80,
      symbolName: "retrieveContext",
      text: "export async function retrieveContext() {}",
    };
    const html = renderToStaticMarkup(
      <CitationDrawer
        citation={sampleCitation}
        repository={sampleRepo}
        onClose={vi.fn()}
        allCitations={[sampleCitation, secondCitation]}
        onSelectCitation={vi.fn()}
      />,
    );

    expect(html).toContain("Sources in this chat (2)");
    expect(html).toContain("repositoryLeases.ts");
    expect(html).toContain("retriever.ts");
  });
});

describe("RepoList Component", () => {
  it("renders repositories with status and handles retry action on failed repository", () => {
    const repos: WorkspaceRepository[] = [
      {
        id: "repo-ok",
        githubId: "1",
        name: "repo-ready",
        owner: "octocat",
        url: "https://github.com/octocat/repo-ready",
        defaultBranch: "main",
        description: null,
        primaryLanguage: "TypeScript",
        indexedAt: new Date().toISOString(),
        embeddingStatus: "ready",
        createdAt: new Date().toISOString(),
      },
      {
        id: "repo-fail",
        githubId: "2",
        name: "repo-failed",
        owner: "octocat",
        url: "https://github.com/octocat/repo-failed",
        defaultBranch: "main",
        description: null,
        primaryLanguage: "TypeScript",
        indexedAt: null,
        embeddingStatus: "failed",
        createdAt: new Date().toISOString(),
      },
    ];

    const html = renderToStaticMarkup(
      <RepoList
        repositories={repos}
        selectedRepo={null}
        onSelectRepo={vi.fn()}
        onDeleteRepo={vi.fn()}
        onRetryRepo={vi.fn()}
        onOpenAddModal={vi.fn()}
      />,
    );

    expect(html).toContain("octocat/repo-ready");
    expect(html).toContain("octocat/repo-failed");
    expect(html).toContain("Retry indexing");
    expect(html).toContain("Failed");
  });

  it("renders empty state when no repositories exist", () => {
    const html = renderToStaticMarkup(
      <RepoList
        repositories={[]}
        selectedRepo={null}
        onSelectRepo={vi.fn()}
        onDeleteRepo={vi.fn()}
        onRetryRepo={vi.fn()}
        onOpenAddModal={vi.fn()}
      />,
    );

    expect(html).toContain("No repositories indexed.");
    expect(html).toContain("Add Repository");
  });
});

describe("ConversationList Component", () => {
  it("renders thread list and handles create conversation trigger", () => {
    const convs: ConversationThread[] = [
      { id: "c1", repositoryId: "r1", title: "Conversation 1" },
      { id: "c2", repositoryId: "r1", title: "Conversation 2" },
    ];

    const html = renderToStaticMarkup(
      <ConversationList
        conversations={convs}
        selectedConversation={null}
        onSelectConversation={vi.fn()}
        onCreateConversation={vi.fn()}
      />,
    );

    expect(html).toContain("Conversation 1");
    expect(html).toContain("Conversation 2");
    expect(html).toContain("Start new conversation");
  });

  it("renders empty state when conversation list is empty", () => {
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

describe("MessageBubble Component", () => {
  it("renders failed state with Retry button for assistant messages", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "m-failed",
          role: "assistant",
          content: "Network error",
          status: "failed",
        }}
        onCitationClick={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Response Failed");
    expect(html).toContain("Retry");
    expect(html).toContain("Network error");
  });
});

describe("ChatWindow Component", () => {
  it("renders file-level indexing transparency in repository header and ready state", () => {
    const repo: WorkspaceRepository = {
      id: "r1",
      githubId: "100",
      name: "drag",
      owner: "octocat",
      url: "https://github.com/octocat/drag",
      defaultBranch: "main",
      description: null,
      primaryLanguage: "TypeScript",
      indexedAt: new Date().toISOString(),
      embeddingStatus: "ready",
      filesIndexed: 45,
      chunksCount: 180,
      createdAt: new Date().toISOString(),
    };

    const html = renderToStaticMarkup(
      <ChatWindow
        selectedRepo={repo}
        selectedConversation={null}
        statusTracker={{
          id: "r1",
          embeddingStatus: "ready",
          indexedAt: repo.indexedAt,
          filesIndexed: 45,
          chunksCount: 180,
        }}
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

    expect(html).toContain("45 files indexed");
    expect(html).toContain("180 chunks");
    expect(html).toContain("Repository Ready");
    expect(html).toContain("Start Conversation");
  });
});

describe("ConversationList Actions", () => {
  it("renders rename and delete action buttons when callbacks are provided", () => {
    const convs: ConversationThread[] = [
      { id: "c1", repositoryId: "r1", title: "Architecture discussion" },
    ];

    const html = renderToStaticMarkup(
      <ConversationList
        conversations={convs}
        selectedConversation={convs[0]}
        onSelectConversation={vi.fn()}
        onCreateConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
      />,
    );

    expect(html).toContain("Architecture discussion");
    expect(html).toContain("Rename conversation");
    expect(html).toContain("Delete conversation");
  });
});

describe("Sidebar Component", () => {
  const sampleRepos: WorkspaceRepository[] = [
    {
      id: "repo-1",
      githubId: "1",
      name: "drag",
      owner: "octocat",
      url: "https://github.com/octocat/drag",
      defaultBranch: "main",
      description: null,
      primaryLanguage: "TypeScript",
      indexedAt: new Date().toISOString(),
      embeddingStatus: "ready",
      createdAt: new Date().toISOString(),
    },
  ];

  it("renders search filter input with shortcut indicator", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        sessionUser={{ name: "Octocat", email: "octocat@github.com" }}
        repositories={sampleRepos}
        selectedRepo={sampleRepos[0]}
        conversations={[]}
        selectedConversation={null}
        isMobileOpen={false}
        onCloseMobile={vi.fn()}
        onSelectRepo={vi.fn()}
        onDeleteRepo={vi.fn()}
        onRetryRepo={vi.fn()}
        onOpenAddModal={vi.fn()}
        onSelectConversation={vi.fn()}
        onCreateConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(html).toContain("Search repositories");
    expect(html).toMatch(/<span class="font-mono">K<\/span>/);
    expect(html).toContain("octocat/drag");
  });
});

describe("Composer Component", () => {
  it("renders textarea with keyboard guidance and send button", () => {
    const html = renderToStaticMarkup(
      <Composer
        messageText="How does leasing work?"
        isStreaming={false}
        chatError=""
        onMessageChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain("<textarea");
    expect(html).toContain("How does leasing work?");
    expect(html).toContain("Enter to send, Shift+Enter for newline");
    expect(html).toContain("Send message (Enter)");
  });

  it("renders error banner when chatError is set", () => {
    const html = renderToStaticMarkup(
      <Composer
        messageText=""
        isStreaming={false}
        chatError="Rate limit exceeded. Please wait a moment."
        onMessageChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain("Rate limit exceeded. Please wait a moment.");
  });
});
