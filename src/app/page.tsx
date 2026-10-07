"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { signIn, signOut, useSession } from "@/lib/auth/client";
import { FolderGit2, Loader2, Globe, Lock } from "lucide-react";
import { GITHUB_ACCESS_SCOPES, type GitHubAccessMode } from "@/lib/auth/accessMode";
import { WorkspaceShell } from "./components/workspace/WorkspaceShell";
import { ConfirmDialog } from "./components/workspace/ConfirmDialog";
import type {
  WorkspaceRepository,
  ConversationThread,
  ChatMessage,
  Citation,
  GithubRepoOption,
  StatusTracker,
  PlanUsageData,
  ResponseMode,
} from "./components/workspace/types";

function GithubIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={`${className} fill-current`}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export default function Home() {
  const { data: session, isPending } = useSession();

  // Access mode state
  const [selectedAccessMode, setSelectedAccessMode] = useState<GitHubAccessMode>("public");
  const [userAccessMode, setUserAccessMode] = useState<GitHubAccessMode>("public");

  useEffect(() => {
    if (!session?.user) return;
    const sessionMode = (session.user as { accessMode?: GitHubAccessMode })?.accessMode;
    if (sessionMode) {
      setUserAccessMode(sessionMode);
    }
    fetch("/api/auth/access-mode")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.accessMode) {
          setUserAccessMode(data.accessMode);
        }
      })
      .catch(() => {});
  }, [session]);

  // Selected state
  const [repositoriesList, setRepositoriesList] = useState<WorkspaceRepository[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<WorkspaceRepository | null>(null);
  const [pendingRepoDelete, setPendingRepoDelete] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [repoDeletePending, setRepoDeletePending] = useState(false);

  const [conversationsList, setConversationsList] = useState<ConversationThread[]>([]);
  const [convsLoading, setConvsLoading] = useState(false);
  const [convsError, setConvsError] = useState<string | null>(null);

  const [selectedConversation, setSelectedConversation] = useState<ConversationThread | null>(null);

  const [messagesList, setMessagesList] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // Add Repository Flow
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GithubRepoOption[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubPage, setGithubPage] = useState(1);
  const [repoAddLoading, setRepoAddLoading] = useState(false);
  const [repoAddError, setRepoAddError] = useState("");

  // Ingestion status tracker for the selected repository
  const [statusTracker, setStatusTracker] = useState<StatusTracker | null>(null);

  // Chat interface
  const [messageText, setMessageText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatError, setChatError] = useState("");

  // Citation code viewer
  const [citationDetail, setCitationDetail] = useState<Citation | null>(null);

  // Plan usage and model selector state
  const [planUsage, setPlanUsage] = useState<PlanUsageData | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("default");
  const [responseMode, setResponseMode] = useState<ResponseMode>("precise");

  // Monotonic request ids. Selecting a repository or thread while a slower request for the
  // previous one is still in flight used to let the late response overwrite the current view,
  // putting thread A's answer and citations under thread B.
  const requestIdRef = useRef(0);
  const nextRequestId = useCallback(() => ++requestIdRef.current, []);

  // Network Fetchers
  const loadUserRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await fetch("/api/repos");
      if (res.ok) {
        const data = await res.json();
        setRepositoriesList(data);
      } else {
        const data = await res.json();
        setReposError(data.error || "Failed to load repositories");
      }
    } catch (err) {
      console.error("Failed to load user repositories:", err);
      setReposError("Network error while loading repositories");
    } finally {
      setReposLoading(false);
    }
  }, []);

  const loadConversations = useCallback(
    async (repoId: string, requestId = nextRequestId()) => {
      setConvsLoading(true);
      setConvsError(null);
      try {
        const res = await fetch(`/api/conversations?repositoryId=${repoId}`);
        const data = res.ok ? await res.json() : await res.json();
        // A newer selection has taken over; this response describes a repository no longer shown.
        if (requestId !== requestIdRef.current) return;
        if (res.ok) {
          setConversationsList(data);
        } else {
          setConvsError(data.error || "Failed to load conversations");
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error("Failed to load conversations:", err);
        setConvsError("Network error while loading conversations");
      } finally {
        if (requestId === requestIdRef.current) setConvsLoading(false);
      }
    },
    [nextRequestId],
  );

  const loadMessages = useCallback(
    async (convId: string, requestId = nextRequestId()) => {
      setMessagesLoading(true);
      setMessagesError(null);
      try {
        const res = await fetch(`/api/conversations/${convId}/messages`);
        const data = await res.json();
        if (requestId !== requestIdRef.current) return;
        if (res.ok) {
          setMessagesList(data);
        } else {
          setMessagesError(data.error || "Failed to load messages");
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error("Failed to load messages:", err);
        setMessagesError("Network error while loading messages");
      } finally {
        if (requestId === requestIdRef.current) setMessagesLoading(false);
      }
    },
    [nextRequestId],
  );

  const loadGithubRepos = useCallback(async (page = 1) => {
    setGithubLoading(true);
    try {
      const res = await fetch(`/api/github/repos?page=${page}&per_page=15`);
      if (res.ok) {
        const data = await res.json();
        if (page === 1) {
          setGithubRepos(data);
        } else {
          setGithubRepos((prev) => [...prev, ...data]);
        }
        setGithubPage(page);
      }
    } catch (err) {
      console.error("Failed to fetch Github repositories:", err);
    } finally {
      setGithubLoading(false);
    }
  }, []);

  const loadPlanUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/user/plan");
      if (res.ok) {
        const data = await res.json();
        setPlanUsage(data);
      }
    } catch (err) {
      console.error("Failed to load user plan usage:", err);
    }
  }, []);

  // Load user repositories and plan usage on session ready
  useEffect(() => {
    if (session) {
      loadUserRepos();
      loadPlanUsage();
    }
  }, [session, loadUserRepos, loadPlanUsage]);

  // Load conversations when selected repository changes
  useEffect(() => {
    const requestId = nextRequestId();
    if (selectedRepo) {
      loadConversations(selectedRepo.id, requestId);
      setSelectedConversation(null);
      setMessagesList([]);
      setStatusTracker({
        id: selectedRepo.id,
        embeddingStatus: selectedRepo.embeddingStatus || "processing",
        indexedAt: selectedRepo.indexedAt,
        filesIndexed: selectedRepo.filesIndexed,
        chunksCount: selectedRepo.chunksCount,
        defaultBranch: selectedRepo.defaultBranch,
        primaryLanguage: selectedRepo.primaryLanguage,
      });
    } else {
      setConversationsList([]);
      setSelectedConversation(null);
      setMessagesList([]);
      setStatusTracker(null);
    }
  }, [selectedRepo, loadConversations, nextRequestId]);

  /**
   * Fetch status once for the selected repository, then poll only while indexing is still active.
   * A ready repository never had its status fetched at all, so storage, file/chunk counts and the
   * commit SHA stayed empty after a reload: `/api/repos` does not return them.
   */
  // Derived so the effect below depends on primitives: the response replaces the whole tracker,
  // so depending on the object itself would tear down and restart the poll on every response.
  const trackedRepoId = statusTracker?.id ?? null;
  const trackedStatus = statusTracker?.embeddingStatus ?? null;

  useEffect(() => {
    if (!trackedRepoId) return;

    let cancelled = false;
    const repoId = trackedRepoId;

    const applyStatus = (data: StatusTracker) => {
      if (cancelled) return;
      setStatusTracker((prev) => (prev && prev.id === repoId ? data : prev));
      setRepositoriesList((prev) =>
        prev.map((r) =>
          r.id === repoId
            ? {
                ...r,
                embeddingStatus: data.embeddingStatus,
                indexedAt: data.indexedAt,
                filesIndexed: data.filesIndexed,
                chunksCount: data.chunksCount,
                defaultBranch: data.defaultBranch ?? r.defaultBranch,
                primaryLanguage: data.primaryLanguage ?? r.primaryLanguage,
                headCommitSha: data.headCommitSha ?? r.headCommitSha,
                totalSizeBytes: data.totalSizeBytes ?? r.totalSizeBytes,
              }
            : r,
        ),
      );
    };

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/status`);
        if (res.ok) applyStatus(await res.json());
      } catch (err) {
        console.error("Error fetching repository status:", err);
      }
    };

    fetchStatus();

    // Poll only while work is outstanding; a terminal status has nothing left to watch.
    const isActive = trackedStatus !== "ready" && trackedStatus !== "failed";
    if (!isActive) return () => { cancelled = true; };

    const interval = setInterval(fetchStatus, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [trackedRepoId, trackedStatus]);

  // Load messages when selected conversation changes. Switching threads invalidates any in-flight
  // message request for the thread being left.
  useEffect(() => {
    const requestId = nextRequestId();
    if (selectedConversation) {
      loadMessages(selectedConversation.id, requestId);
    } else {
      setMessagesList([]);
    }
  }, [selectedConversation, loadMessages, nextRequestId]);

  // Triggered when modal opens
  useEffect(() => {
    if (isAddingRepo && session) {
      loadGithubRepos(1);
    }
  }, [isAddingRepo, session, loadGithubRepos]);

  const handleAddRepo = async (urlStr: string, branchStr?: string) => {
    setRepoAddLoading(true);
    setRepoAddError("");
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlStr,
          branch: branchStr ? branchStr.trim() : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        const isLimitReached =
          res.status === 403 &&
          (data.code === "REPOSITORY_LIMIT_REACHED" ||
            (typeof data.error === "string" &&
              data.error.toLowerCase().includes("repository limit")));
        if (isLimitReached) {
          const nextTier = planUsage?.plan === "free" ? "Hobby" : "Enterprise";
          setRepoAddError(`Repository limit reached.\nUpgrade to ${nextTier} to add more repositories.`);
        } else {
          setRepoAddError(data.error || "Failed to add repository");
        }
      } else {
        setIsAddingRepo(false);
        await loadPlanUsage();

        // Immediately set status tracker to show ingestion progress in chat window
        setStatusTracker({
          id: data.repositoryId,
          embeddingStatus: data.status || "processing",
          indexedAt: null,
          filesIndexed: 0,
          chunksCount: 0,
        });

        // Fetch refreshed repo list and select the newly added repo
        const res2 = await fetch("/api/repos");
        if (res2.ok) {
          const list = (await res2.json()) as WorkspaceRepository[];
          setRepositoriesList(list);
          const found = list.find((r) => r.id === data.repositoryId);
          if (found) {
            setSelectedRepo(found);
          }
        }
      }
    } catch (err) {
      setRepoAddError(
        err instanceof Error && err.message ? err.message : "An unexpected error occurred",
      );
    } finally {
      setRepoAddLoading(false);
    }
  };

  const handleRetryRepo = async (repo: WorkspaceRepository) => {
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The indexed branch must travel with the retry. Without it the server defaults to `main`,
        // and a repository indexed on `staging` is rejected with 409 because the row is shared.
        body: JSON.stringify({ url: repo.url, branch: repo.defaultBranch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not restart indexing.");
      }
      // Update local state to processing immediately
      setStatusTracker({
        id: repo.id,
        embeddingStatus: "processing",
        indexedAt: repo.indexedAt,
      });
      setRepositoriesList((prev) =>
        prev.map((r) => (r.id === repo.id ? { ...r, embeddingStatus: "processing" } : r)),
      );
      if (selectedRepo?.id === repo.id) {
        setSelectedRepo((prev) => (prev ? { ...prev, embeddingStatus: "processing" } : null));
      }
    } catch (err) {
      console.error("Failed to retry repository indexing:", err);
      throw err;
    }
  };

  const handleDeleteRepo = async (repoId: string) => {
    const res = await fetch(`/api/repos/${repoId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Could not remove this repository.");
    }
    setPendingRepoDelete(null);
    if (selectedRepo?.id === repoId) {
      setSelectedRepo(null);
    }
    await Promise.all([loadUserRepos(), loadPlanUsage()]);
  };

  const handleCreateConversation = async () => {
    if (!selectedRepo) return;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repositoryId: selectedRepo.id,
        title: `Conversation ${conversationsList.length + 1}`,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Could not start a new chat.");
    }
    const data = await res.json();
    await loadConversations(selectedRepo.id);
    setSelectedConversation({
      id: data.conversationId,
      title: data.title,
      repositoryId: selectedRepo.id,
    });
  };

  const handleRenameConversation = async (convId: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setConversationsList((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, title: newTitle } : c)),
        );
        if (selectedConversation?.id === convId) {
          setSelectedConversation((prev) => (prev ? { ...prev, title: newTitle } : null));
        }
      }
    } catch (err) {
      console.error("Failed to rename conversation:", err);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    const res = await fetch(`/api/conversations/${convId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Could not delete this chat.");
    }
    setConversationsList((prev) => prev.filter((c) => c.id !== convId));
    if (selectedConversation?.id === convId) {
      setSelectedConversation(null);
      setMessagesList([]);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConversation || !messageText.trim() || isStreaming) return;

    const userText = messageText;
    // Captured so the stream and its completion reload stay bound to this thread, even if the user
    // switches conversations while the response is still arriving.
    const conversationId = selectedConversation.id;
    const requestId = nextRequestId();
    setMessageText("");
    setChatError("");
    setIsStreaming(true);

    const tempUserMsg = {
      id: `temp-u-${Date.now()}`,
      role: "user" as const,
      content: userText,
      status: "completed" as const,
    };
    setMessagesList((prev) => [...prev, tempUserMsg]);

    const tempAssistantId = `temp-a-${Date.now()}`;
    const tempAssistantMsg = {
      id: tempAssistantId,
      role: "assistant" as const,
      content: "",
      status: "streaming" as const,
      citations: [],
    };
    setMessagesList((prev) => [...prev, tempAssistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: userText,
          model: selectedModel !== "default" ? selectedModel : undefined,
          responseMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const isQuota =
          res.status === 429 &&
          (data.code === "MONTHLY_QUOTA_EXCEEDED" ||
            (typeof data.error === "string" &&
              data.error.toLowerCase().includes("monthly rag query quota")));
        const displayErr = isQuota
          ? "You've reached your monthly RAG query limit."
          : (data.error || "Generation failed");

        setChatError(displayErr);
        // Reload from the server instead of leaving a local temp bubble behind. A temp id is not a
        // UUID, so retrying it later would send an unparseable value as retryMessageId and fail
        // before generation ever starts.
        if (requestId === requestIdRef.current) {
          setMessagesList((prev) =>
            prev.map((msg) =>
              msg.id === tempAssistantId
                ? { ...msg, status: "failed", content: displayErr }
                : msg,
            ),
          );
          await loadMessages(conversationId, requestId);
        }
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No reader on response stream");
      }

      const decoder = new TextDecoder();
      let streamText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        streamText += textChunk;

        if (requestId !== requestIdRef.current) continue;
        setMessagesList((prev) =>
          prev.map((msg) =>
            msg.id === tempAssistantId ? { ...msg, content: streamText } : msg,
          ),
        );
      }

      // Reload the thread this stream belongs to, not whichever one is displayed now.
      await loadMessages(conversationId, requestId);
      loadPlanUsage();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      console.error("Chat error:", err);
      if (requestId !== requestIdRef.current) return;
      setChatError(message || "An unexpected error occurred");
      setMessagesList((prev) =>
        prev.map((msg) =>
          msg.id === tempAssistantId
            ? { ...msg, status: "failed", content: message || "Network error" }
            : msg,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleRetryMessage = async (failedMsg: ChatMessage) => {
    if (!selectedConversation || isStreaming) return;

    // Find the preceding user message in messagesList
    const failedIdx = messagesList.findIndex((m) => m.id === failedMsg.id);
    let promptToRetry = "";
    if (failedIdx > 0 && messagesList[failedIdx - 1].role === "user") {
      promptToRetry = messagesList[failedIdx - 1].content;
    } else {
      for (let i = failedIdx - 1; i >= 0; i--) {
        if (messagesList[i].role === "user") {
          promptToRetry = messagesList[i].content;
          break;
        }
      }
    }

    if (!promptToRetry) return;

    // A local temp id was never persisted, so the server has nothing to delete and the UUID column
    // rejects it outright. Retry those without an id; the server keeps its failed turn as history
    // and the reload below replaces the local bubble with the saved rows.
    const isSavedMessage = !failedMsg.id.startsWith("temp-");
    const conversationId = selectedConversation.id;
    const requestId = nextRequestId();

    setIsStreaming(true);
    setChatError("");
    setMessagesList((prev) =>
      prev.map((msg) =>
        msg.id === failedMsg.id
          ? { ...msg, status: "streaming", content: "", citations: [] }
          : msg,
      ),
    );

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: promptToRetry,
          isRetry: true,
          retryMessageId: isSavedMessage ? failedMsg.id : undefined,
          model: selectedModel !== "default" ? selectedModel : undefined,
          responseMode,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const isQuota =
          res.status === 429 &&
          (data.code === "MONTHLY_QUOTA_EXCEEDED" ||
            (typeof data.error === "string" &&
              data.error.toLowerCase().includes("monthly rag query quota")));
        const errText = isQuota
          ? "You've reached your monthly RAG query limit."
          : (data.error || "Generation retry failed");

        setChatError(errText);
        if (requestId !== requestIdRef.current) return;
        setMessagesList((prev) =>
          prev.map((msg) =>
            msg.id === failedMsg.id
              ? { ...msg, status: "failed", content: errText }
              : msg,
          ),
        );
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader on response stream");

      const decoder = new TextDecoder();
      let streamText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        streamText += textChunk;

        if (requestId !== requestIdRef.current) continue;
        setMessagesList((prev) =>
          prev.map((msg) =>
            msg.id === failedMsg.id ? { ...msg, content: streamText } : msg,
          ),
        );
      }

      await loadMessages(conversationId, requestId);
      loadPlanUsage();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      console.error("Chat retry error:", err);
      if (requestId !== requestIdRef.current) return;
      setChatError(message || "An unexpected error occurred during retry");
      setMessagesList((prev) =>
        prev.map((msg) =>
          msg.id === failedMsg.id
            ? { ...msg, status: "failed", content: message || "Network connection interrupted" }
            : msg,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleCitationClick = (citation: Citation) => {
    setCitationDetail(citation);
  };

  const handleSignIn = async () => {
    await signIn.social({
      provider: "github",
      callbackURL: "/",
      scopes: [...GITHUB_ACCESS_SCOPES[selectedAccessMode]],
    });
  };

  const handleUpgradeAccess = async () => {
    await signIn.social({
      provider: "github",
      callbackURL: "/",
      scopes: [...GITHUB_ACCESS_SCOPES.full],
    });
  };

  const handleSignOut = async () => {
    await signOut();
  };

  if (isPending) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#050505]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!session) {
    // Unauthenticated Welcome Landing Page
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#030303] text-zinc-100 font-sans">
        <div className="absolute top-[-20%] left-[-10%] h-[600px] w-[600px] rounded-full bg-blue-500/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[600px] w-[600px] rounded-full bg-teal-500/10 blur-[120px]" />

        <div className="relative z-10 w-full max-w-lg px-6 text-center">
          <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
            <FolderGit2 className="h-8 w-8 text-teal-400" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Meet <span className="bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent">DRAG</span>
          </h1>
          <p className="mt-4 text-base text-zinc-400 leading-relaxed">
            Developer Repository Augmented Generation. Connect your GitHub repositories, index their structure semantically, and chat with your codebase.
          </p>

          <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 backdrop-blur-md shadow-2xl text-left">
            <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider text-center">
              Select GitHub Access Mode
            </h3>
            <p className="mt-1 text-xs text-zinc-400 text-center">
              Choose repository access level before authorizing with GitHub.
            </p>

            <div className="mt-5 space-y-3">
              {/* Option 1: Public-only */}
              <button
                type="button"
                onClick={() => setSelectedAccessMode("public")}
                aria-pressed={selectedAccessMode === "public"}
                className={`w-full text-left p-3.5 rounded-xl border cursor-pointer transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${
                  selectedAccessMode === "public"
                    ? "border-teal-500 bg-teal-500/10 shadow-sm"
                    : "border-zinc-800/80 bg-zinc-950/40 hover:border-zinc-600 hover:bg-zinc-900/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe
                      className={`h-4 w-4 shrink-0 ${selectedAccessMode === "public" ? "text-teal-400" : "text-zinc-400"}`}
                    />
                    <span className="text-xs font-bold text-white">Public-only</span>
                  </div>
                  <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/20">
                    Least Privilege
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                  Access and index public repositories only. Private repositories are rejected.
                </p>
              </button>

              {/* Option 2: Full repository access */}
              <button
                type="button"
                onClick={() => setSelectedAccessMode("full")}
                aria-pressed={selectedAccessMode === "full"}
                className={`w-full text-left p-3.5 rounded-xl border cursor-pointer transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${
                  selectedAccessMode === "full"
                    ? "border-teal-500 bg-teal-500/10 shadow-sm"
                    : "border-zinc-800/80 bg-zinc-950/40 hover:border-zinc-600 hover:bg-zinc-900/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock
                      className={`h-4 w-4 shrink-0 ${selectedAccessMode === "full" ? "text-teal-400" : "text-zinc-400"}`}
                    />
                    <span className="text-xs font-bold text-white">Full repository access</span>
                  </div>
                  <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded border border-zinc-700">
                    Public + Private
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                  Access public, private, and organization repositories.
                </p>
              </button>
            </div>

            <div className="mt-6">
              <button
                onClick={handleSignIn}
                className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-bold text-zinc-950 hover:bg-zinc-200 transition active:scale-98 shadow-lg cursor-pointer"
              >
                <GithubIcon className="h-5 w-5" />
                Sign in with GitHub ({selectedAccessMode === "public" ? "Public-only" : "Full Access"})
              </button>
            </div>
            <p className="mt-3 text-[11px] text-center text-zinc-500">
              {selectedAccessMode === "public"
                ? "Requests minimum permissions. You can upgrade to Full access later."
                : "Requests repo and read:org scopes to read private code and org memberships."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <WorkspaceShell
      sessionUser={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      repositories={repositoriesList}
      selectedRepo={selectedRepo}
      reposLoading={reposLoading}
      reposError={reposError}
      conversations={conversationsList}
      selectedConversation={selectedConversation}
      convsLoading={convsLoading}
      convsError={convsError}
      messages={messagesList}
      messagesLoading={messagesLoading}
      messagesError={messagesError}
      statusTracker={statusTracker}
      isAddingRepo={isAddingRepo}
      githubRepos={githubRepos}
      githubLoading={githubLoading}
      repoAddLoading={repoAddLoading}
      repoAddError={repoAddError}
      messageText={messageText}
      isStreaming={isStreaming}
      chatError={chatError}
      selectedCitation={citationDetail}
      onSelectRepo={setSelectedRepo}
      onDeleteRepo={(repoId) =>
        setPendingRepoDelete({
          id: repoId,
          label: `${repositoriesList.find((r) => r.id === repoId)?.owner ?? ""}/${repositoriesList.find((r) => r.id === repoId)?.name ?? "repository"}`,
        })
      }
      onRetryRepo={handleRetryRepo}
      onOpenAddModal={() => setIsAddingRepo(true)}
      onCloseAddModal={() => setIsAddingRepo(false)}
      onAddRepo={handleAddRepo}
      onLoadMoreGithub={() => loadGithubRepos(githubPage + 1)}
      onSelectConversation={setSelectedConversation}
      onCreateConversation={handleCreateConversation}
      onRenameConversation={handleRenameConversation}
      onDeleteConversation={handleDeleteConversation}
      onMessageChange={setMessageText}
      onSendMessage={handleSendMessage}
      onCitationClick={handleCitationClick}
      onCloseCitation={() => setCitationDetail(null)}
      onSignOut={handleSignOut}
      onSuggestionClick={(prompt) => setMessageText(prompt)}
      onRetryMessage={handleRetryMessage}
      accessMode={userAccessMode}
      onUpgradeAccess={handleUpgradeAccess}
      planUsage={planUsage}
      isPlanModalOpen={isPlanModalOpen}
      onOpenPlanModal={() => setIsPlanModalOpen(true)}
      onClosePlanModal={() => setIsPlanModalOpen(false)}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      responseMode={responseMode}
      onResponseModeChange={setResponseMode}
      />

      <ConfirmDialog
        isOpen={pendingRepoDelete !== null}
        title="Remove repository?"
        message={`"${pendingRepoDelete?.label ?? "This repository"}" will be removed from your workspace. The indexed chunks and its chat threads are deleted. Re-adding it later re-indexes from scratch.`}
        pending={pendingRepoDelete !== null && repoDeletePending}
        onConfirm={async () => {
          if (!pendingRepoDelete) return;
          setRepoDeletePending(true);
          try {
            await handleDeleteRepo(pendingRepoDelete.id);
          } finally {
            setRepoDeletePending(false);
          }
        }}
        onCancel={() => setPendingRepoDelete(null)}
      />
    </>
  );
}
