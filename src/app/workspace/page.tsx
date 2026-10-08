"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "@/lib/auth/client";
import { Globe, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GithubIcon } from "@/components/ui/GithubIcon";
import { GITHUB_ACCESS_SCOPES, type GitHubAccessMode } from "@/lib/auth/accessMode";
import { cn } from "@/lib/cn";
import { WorkspaceShell } from "../components/workspace/WorkspaceShell";
import { ConfirmDialog } from "../components/workspace/ConfirmDialog";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  type WorkspaceRepository,
  type ConversationThread,
  type ChatMessage,
  type Citation,
  type GithubRepoOption,
  type StatusTracker,
  type PlanUsageData,
  type ResponseMode,
} from "../components/workspace/types";

/**
 * Reorders a list in place to match `orderedIds`. Rows the id list does not mention keep their
 * relative order at the end, so an optimistic apply never drops a repository that a concurrent
 * status poll or a background refetch just added to the list.
 */
function orderByIds<T extends { id: string }>(list: T[], orderedIds: string[]): T[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return [
    ...list
      .filter((item) => rank.has(item.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    ...list.filter((item) => !rank.has(item.id)),
  ];
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
  const [repoDeleteError, setRepoDeleteError] = useState<string | null>(null);

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
  const [isModelManuallyPicked, setIsModelManuallyPicked] = useState(false);
  const [responseMode, setResponseMode] = useState<ResponseMode>("precise");

// Monotonic request ids, one per independently-cancelled load. Selecting a repository or thread
  // while a slower request for the previous one is still in flight used to let the late response
  // overwrite the current view, putting thread A's answer and citations under thread B.
  //
  // Conversations and messages are separate counters because they are separate loads: the repository
  // effect clears `selectedConversation`, which ran the message effect and advanced a shared
  // counter, discarding the conversation response it had just started and leaving `convsLoading`
  // stuck on. A stale call is also rejected *before* it sets loading state, so a superseded stream
  // completion cannot strand the spinner on the current thread.
  const convsRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
  const nextConvsRequestId = useCallback(() => ++convsRequestIdRef.current, []);
  const nextMessagesRequestId = useCallback(() => ++messagesRequestIdRef.current, []);

  // Drag-and-drop ordering. Each list gets its own promise chain so a repository drop and a
  // conversation drop never wait on each other, plus a monotonic write counter: a write only
  // rolls the list back if it is still the newest one, so a slow response cannot undo a drag the
  // user has already made afterwards. `confirmed*OrderRef` holds the order the server last
  // acknowledged, which is the only thing a failed write may restore.
  const repoOrderSeqRef = useRef(0);
  const repoOrderChainRef = useRef<Promise<void>>(Promise.resolve());
  const confirmedRepoOrderRef = useRef<string[]>([]);
  const convOrderSeqRef = useRef(0);
  const convOrderChainRef = useRef<Promise<void>>(Promise.resolve());
  const confirmedConvOrderRef = useRef<{ repositoryId: string; ids: string[] }>({
    repositoryId: "",
    ids: [],
  });

  // Monotonic edit request sequence per message.
  // When an edit fails, only roll back if this request is still the newest edit for this message.
  // Otherwise, a slow failure from an earlier edit would roll back a newer edit that already succeeded.
  const messageEditSeqRef = useRef<Map<string, number>>(new Map());

  // Repository id requested via query params `?repo=<id>`.
  const pendingRepoSelectionRef = useRef<string | null>(null);

  // Network Fetchers
  const loadUserRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await fetch("/api/repos");
      if (res.ok) {
        const data = (await res.json()) as WorkspaceRepository[];
        setRepositoriesList(data);
        confirmedRepoOrderRef.current = data.map((repo) => repo.id);
        const requested = pendingRepoSelectionRef.current;
        if (requested) {
          pendingRepoSelectionRef.current = null;
          const match = data.find((repo) => repo.id === requested);
          if (match) setSelectedRepo(match);
        }
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
    async (repoId: string, requestId = nextConvsRequestId()) => {
      // Reject a superseded call before touching loading state, otherwise it would raise the
      // spinner and never clear it.
      if (requestId !== convsRequestIdRef.current) return;
      setConvsLoading(true);
      setConvsError(null);
      try {
        const res = await fetch(`/api/conversations?repositoryId=${repoId}`);
        const data = res.ok ? await res.json() : await res.json();
        // A newer selection has taken over; this response describes a repository no longer shown.
        if (requestId !== convsRequestIdRef.current) return;
        if (res.ok) {
          setConversationsList(data);
          confirmedConvOrderRef.current = {
            repositoryId: repoId,
            ids: (data as ConversationThread[]).map((conv) => conv.id),
          };
        } else {
          setConvsError(data.error || "Failed to load conversations");
        }
      } catch (err) {
        if (requestId !== convsRequestIdRef.current) return;
        console.error("Failed to load conversations:", err);
        setConvsError("Network error while loading conversations");
      } finally {
        if (requestId === convsRequestIdRef.current) setConvsLoading(false);
      }
    },
    [nextConvsRequestId],
  );

  const loadMessages = useCallback(
    async (convId: string, requestId = nextMessagesRequestId()) => {
      // An old stream's completion calls this with its own id after the user has moved on. Bail
      // before setting loading state, or the current thread shows a spinner forever.
      if (requestId !== messagesRequestIdRef.current) return;
      setMessagesLoading(true);
      setMessagesError(null);
      try {
        const res = await fetch(`/api/conversations/${convId}/messages`);
        const data = await res.json();
        if (requestId !== messagesRequestIdRef.current) return;
        if (res.ok) {
          setMessagesList(data);
        } else {
          setMessagesError(data.error || "Failed to load messages");
        }
      } catch (err) {
        if (requestId !== messagesRequestIdRef.current) return;
        console.error("Failed to load messages:", err);
        setMessagesError("Network error while loading messages");
      } finally {
        if (requestId === messagesRequestIdRef.current) setMessagesLoading(false);
      }
    },
    [nextMessagesRequestId],
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

  // Keyed on the user id, not the `session` object. Better Auth refetches the session when the
  // window regains focus and hands back a fresh object identity for the same signed-in user, which
  // re-ran this effect and flipped the sidebar to its loading state every time the user alt-tabbed
  // back in. The id is the only part that should trigger a load.
  const sessionUserId = session?.user?.id;

  // Load user repositories and plan usage on session ready
  useEffect(() => {
    if (sessionUserId) {
      // `?repo=<repositoryId>&q=<prompt>` query params allow deep-linking, so a
      // repository opens selected with its indexing progress already polling, and a
      // prompt lands in the composer. Read once, off `window`, because the page is
      // also rendered without a query string.
      const params = new URLSearchParams(window.location.search);
      pendingRepoSelectionRef.current = params.get("repo");
      const prompt = params.get("q");
      if (prompt) setMessageText(prompt.slice(0, MAX_CHAT_MESSAGE_LENGTH));
      loadUserRepos();
      loadPlanUsage();
    }
  }, [sessionUserId, loadUserRepos, loadPlanUsage]);

  // Load conversations when selected repository changes
  useEffect(() => {
    nextMessagesRequestId();
    if (selectedRepo) {
      loadConversations(selectedRepo.id, nextConvsRequestId());
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
  }, [selectedRepo, loadConversations, nextConvsRequestId, nextMessagesRequestId]);

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
    const requestId = nextMessagesRequestId();
    if (selectedConversation) {
      loadMessages(selectedConversation.id, requestId);
    } else {
      setMessagesList([]);
    }
  }, [selectedConversation, loadMessages, nextMessagesRequestId]);

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
          confirmedRepoOrderRef.current = list.map((repo) => repo.id);
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
    const requestId = nextMessagesRequestId();
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
        if (requestId === messagesRequestIdRef.current) {
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

        if (requestId !== messagesRequestIdRef.current) continue;
        setMessagesList((prev) =>
          prev.map((msg) =>
            msg.id === tempAssistantId ? { ...msg, content: streamText } : msg,
          ),
        );
      }

      // Reload the thread this stream belongs to, not whichever one is displayed now.
      await loadMessages(conversationId, requestId);
      // The server names a brand new thread from its first question and awaits that write before
      // closing the stream, so the title is already committed by the time this reader sees `done`
      // and needs no settling delay. Scoped to this repo, and skipped once the user has moved on,
      // so a slow title can't repaint a thread the user already left.
      if (requestId === messagesRequestIdRef.current && selectedRepo) {
        loadConversations(selectedRepo.id);
      }
      loadPlanUsage();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      console.error("Chat error:", err);
      if (requestId !== messagesRequestIdRef.current) return;
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

  const handleRetryMessage = useCallback(
    async (failedMsg: ChatMessage) => {
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
    const requestId = nextMessagesRequestId();

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
        if (requestId !== messagesRequestIdRef.current) return;
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

        if (requestId !== messagesRequestIdRef.current) continue;
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
      if (requestId !== messagesRequestIdRef.current) return;
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
  },
  [
    selectedConversation,
    isStreaming,
    messagesList,
    selectedModel,
    responseMode,
    nextMessagesRequestId,
    loadMessages,
    loadPlanUsage,
  ],
  );

  const handleSignIn = async () => {
    await signIn.social({
      provider: "github",
      callbackURL: "/workspace",
      scopes: [...GITHUB_ACCESS_SCOPES[selectedAccessMode]],
    });
  };

  const handleUpgradeAccess = async () => {
    await signIn.social({
      provider: "github",
      callbackURL: "/workspace",
      scopes: [...GITHUB_ACCESS_SCOPES.full],
    });
  };

  const handleSignOut = async () => {
    await signOut();
  };

  // Stable identities for the memoized workspace subtrees. `messageText` is component state, so
  // every keystroke re-renders this whole tree; without these the inline arrows below are new
  // functions each render, `memo` never hits, and the sidebar, every markdown message bubble and
  // all three modals re-render per character.
  const handleCitationClick = useCallback((citation: Citation) => {
    setCitationDetail(citation);
  }, []);

  const handleSuggestionClick = useCallback((prompt: string) => {
    setMessageText(prompt);
  }, []);

  const handleRegenerateMessage = useCallback(
    async (targetMsg: ChatMessage) => {
      if (!selectedConversation || isStreaming) return;

      const targetIdx = messagesList.findIndex((m) => m.id === targetMsg.id);
      let promptToRegenerate = "";
      if (targetIdx > 0 && messagesList[targetIdx - 1].role === "user") {
        promptToRegenerate = messagesList[targetIdx - 1].content;
      } else {
        for (let i = targetIdx - 1; i >= 0; i--) {
          if (messagesList[i].role === "user") {
            promptToRegenerate = messagesList[i].content;
            break;
          }
        }
      }

      if (!promptToRegenerate) return;

      const conversationId = selectedConversation.id;
      const requestId = nextMessagesRequestId();

      setIsStreaming(true);
      setChatError("");
      setMessagesList((prev) =>
        prev.map((msg) =>
          msg.id === targetMsg.id
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
            message: promptToRegenerate,
            isRegenerate: true,
            regenerateMessageId: targetMsg.id,
            model: selectedModel !== "default" ? selectedModel : undefined,
            responseMode,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const isQuota =
            res.status === 429 &&
            (data?.code === "MONTHLY_QUOTA_EXCEEDED" ||
              (typeof data?.error === "string" &&
                data.error.toLowerCase().includes("monthly rag query quota")));
          const errText = isQuota
            ? "You've reached your monthly RAG query limit."
            : (data?.error || "Generation retry failed");

          setChatError(errText);
          if (requestId !== messagesRequestIdRef.current) return;
          setMessagesList((prev) =>
            prev.map((msg) =>
              msg.id === targetMsg.id
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

          if (requestId !== messagesRequestIdRef.current) continue;
          setMessagesList((prev) =>
            prev.map((msg) =>
              msg.id === targetMsg.id ? { ...msg, content: streamText } : msg,
            ),
          );
        }

        await loadMessages(conversationId, requestId);
        loadPlanUsage();
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        console.error("Chat regenerate error:", err);
        if (requestId !== messagesRequestIdRef.current) return;
        setChatError(message || "An unexpected error occurred during regeneration");
        setMessagesList((prev) =>
          prev.map((msg) =>
            msg.id === targetMsg.id
              ? { ...msg, status: "failed", content: message || "Network connection interrupted" }
              : msg,
          ),
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [
      selectedConversation,
      isStreaming,
      messagesList,
      selectedModel,
      responseMode,
      nextMessagesRequestId,
      loadMessages,
      loadPlanUsage,
    ],
  );

  const handleEditMessage = useCallback(
    async (content: string, messageId?: string) => {
      const trimmed = content.trim();
      if (!trimmed || !messageId) return;
      if (messageId.startsWith("temp-")) return;
      if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
        setChatError(
          `Message exceeds maximum allowed length of ${MAX_CHAT_MESSAGE_LENGTH} characters.`,
        );
        return;
      }

      const previousMessage = messagesList.find((msg) => msg.id === messageId);
      const originalContent = previousMessage?.content ?? "";

      const editSeq = (messageEditSeqRef.current.get(messageId) ?? 0) + 1;
      messageEditSeqRef.current.set(messageId, editSeq);

      setMessagesList((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, content: trimmed } : msg)),
      );

      if (selectedConversation) {
        try {
          const res = await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId, content: trimmed }),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => null);
            const errText = data?.error || `Failed to save edited message (${res.status})`;
            setChatError(errText);
            if (messageEditSeqRef.current.get(messageId) === editSeq) {
              setMessagesList((prev) =>
                prev.map((msg) =>
                  msg.id === messageId ? { ...msg, content: originalContent } : msg,
                ),
              );
            }
          }
        } catch (err) {
          console.error("Failed to persist edited message:", err);
          setChatError("Network error: Failed to save edited message");
          if (messageEditSeqRef.current.get(messageId) === editSeq) {
            setMessagesList((prev) =>
              prev.map((msg) =>
                msg.id === messageId ? { ...msg, content: originalContent } : msg,
              ),
            );
          }
        }
      }
    },
    [selectedConversation, messagesList],
  );

  const handleCloseCitation = useCallback(() => setCitationDetail(null), []);

  const handleDeleteRepoClick = useCallback(
    (repoId: string) => {
      setRepoDeleteError(null);
      setPendingRepoDelete({
        id: repoId,
        label: `${repositoriesList.find((r) => r.id === repoId)?.owner ?? ""}/${repositoriesList.find((r) => r.id === repoId)?.name ?? "repository"}`,
      });
    },
    [repositoriesList],
  );

  const handleOpenAddModal = useCallback(() => setIsAddingRepo(true), []);
  const handleCloseAddModal = useCallback(() => setIsAddingRepo(false), []);
  const handleOpenPlanModal = useCallback(() => setIsPlanModalOpen(true), []);
  const handleClosePlanModal = useCallback(() => setIsPlanModalOpen(false), []);
  const handleLoadMoreGithub = useCallback(
    () => loadGithubRepos(githubPage + 1),
    [githubPage, loadGithubRepos],
  );

  const handleReorderRepositories = useCallback((orderedIds: string[]) => {
    const writeId = ++repoOrderSeqRef.current;
    setRepositoriesList((prev) => orderByIds(prev, orderedIds));
    repoOrderChainRef.current = repoOrderChainRef.current
      .catch(() => {})
      .then(async () => {
        const res = await fetch("/api/repos/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        });
        if (!res.ok) throw new Error("Could not save the repository order.");
        confirmedRepoOrderRef.current = orderedIds;
      })
      .catch((err: unknown) => {
        if (writeId !== repoOrderSeqRef.current) return;
        setRepositoriesList((prev) => orderByIds(prev, confirmedRepoOrderRef.current));
        setReposError(err instanceof Error ? err.message : "Could not save the repository order.");
      });
  }, []);

  const handleReorderConversations = useCallback(
    (repositoryId: string, orderedIds: string[]) => {
      // `ConversationList` commits only the rows its own filter shows, unlike `Sidebar`, which
      // re-appends the repositories it hid. The route writes a dense 0..n-1 order for exactly the
      // ids it is given, so the hidden threads have to be carried here or they keep a stale
      // position and interleave with the ones just ordered.
      const complete = [
        ...orderedIds,
        ...conversationsList
          .filter((conv) => !orderedIds.includes(conv.id))
          .map((conv) => conv.id),
      ];
      const writeId = ++convOrderSeqRef.current;
      setConversationsList((prev) => orderByIds(prev, complete));
      convOrderChainRef.current = convOrderChainRef.current
        .catch(() => {})
        .then(async () => {
          const res = await fetch("/api/conversations/reorder", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repositoryId, orderedIds: complete }),
          });
          if (!res.ok) throw new Error("Could not save the chat order.");
          confirmedConvOrderRef.current = { repositoryId, ids: complete };
        })
        .catch((err: unknown) => {
          const confirmed = confirmedConvOrderRef.current;
          if (writeId !== convOrderSeqRef.current) return;
          if (confirmed.repositoryId !== repositoryId) return;
          setConversationsList((prev) => orderByIds(prev, confirmed.ids));
          setConvsError(err instanceof Error ? err.message : "Could not save the chat order.");
        });
    },
    [conversationsList],
  );

  if (isPending) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#050505]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-page bg-hero px-6 py-12 text-ink">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center text-center">
            <Link
              href="/"
              aria-label="DRAG home"
              className="inline-flex items-center transition-opacity duration-150 hover:opacity-75"
            >
              <span className="font-brand text-3xl sm:text-4xl leading-none tracking-wide text-ink">
                DRAG
              </span>
            </Link>

            <h1 className="mt-6 font-display text-[28px] font-semibold tracking-display text-ink">
              Sign in to your workspace
            </h1>
          </div>

          <div role="group" aria-label="GitHub access mode" className="mt-6 space-y-2">
            <button
              type="button"
              onClick={() => setSelectedAccessMode("public")}
              aria-pressed={selectedAccessMode === "public"}
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-card border p-3 text-center transition-colors duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                selectedAccessMode === "public"
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface hover:border-line-2 hover:bg-surface-2",
              )}
            >
              <span className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-ink">
                <Globe
                  className={cn(
                    "size-4 shrink-0",
                    selectedAccessMode === "public" ? "text-accent-ink" : "text-ink-4",
                  )}
                  aria-hidden
                />
                Public-only
              </span>
              <span className="block text-xs font-medium text-ink-3">
                Index public repositories. Private ones are rejected.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedAccessMode("full")}
              aria-pressed={selectedAccessMode === "full"}
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-card border p-3 text-center transition-colors duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                selectedAccessMode === "full"
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface hover:border-line-2 hover:bg-surface-2",
              )}
            >
              <span className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-ink">
                <Lock
                  className={cn(
                    "size-4 shrink-0",
                    selectedAccessMode === "full" ? "text-accent-ink" : "text-ink-4",
                  )}
                  aria-hidden
                />
                Full repository access
              </span>
              <span className="block text-xs font-medium text-ink-3">
                Public, private, and organization repositories.
              </span>
            </button>
          </div>

          <Button size="lg" onClick={handleSignIn} className="mt-6 w-full">
            <GithubIcon className="size-4" />
            Sign in with GitHub ({selectedAccessMode === "public" ? "Public-only" : "Full Access"})
          </Button>

          <p className="mt-8 text-center text-xs text-ink-4">
            <Link
              href="/"
              className="font-semibold text-ink-3 transition-colors duration-150 hover:text-ink"
            >
              Back to the DRAG overview
            </Link>
          </p>
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
      onDeleteRepo={handleDeleteRepoClick}
      onRetryRepo={handleRetryRepo}
      onOpenAddModal={handleOpenAddModal}
      onCloseAddModal={handleCloseAddModal}
      onAddRepo={handleAddRepo}
      onLoadMoreGithub={handleLoadMoreGithub}
      onSelectConversation={setSelectedConversation}
      onCreateConversation={handleCreateConversation}
      onRenameConversation={handleRenameConversation}
      onDeleteConversation={handleDeleteConversation}
      onReorderRepositories={handleReorderRepositories}
      onReorderConversations={handleReorderConversations}
      onMessageChange={setMessageText}
      onSendMessage={handleSendMessage}
      onCitationClick={handleCitationClick}
      onCloseCitation={handleCloseCitation}
      onSignOut={handleSignOut}
      onSuggestionClick={handleSuggestionClick}
      onEditMessage={handleEditMessage}
      onRetryMessage={handleRetryMessage}
      onRegenerateMessage={handleRegenerateMessage}
      accessMode={userAccessMode}
      onUpgradeAccess={handleUpgradeAccess}
      planUsage={planUsage}
      isPlanModalOpen={isPlanModalOpen}
      onOpenPlanModal={handleOpenPlanModal}
      onClosePlanModal={handleClosePlanModal}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      manuallyPickedModel={isModelManuallyPicked}
      onManualPickModel={() => setIsModelManuallyPicked(true)}
      responseMode={responseMode}
      onResponseModeChange={setResponseMode}
      />

      <ConfirmDialog
        isOpen={pendingRepoDelete !== null}
        title="Remove repository?"
        message={`"${pendingRepoDelete?.label ?? "This repository"}" will be removed from your workspace. The indexed chunks and its chat threads are deleted. Re-adding it later re-indexes from scratch.`}
        error={repoDeleteError}
        pending={pendingRepoDelete !== null && repoDeletePending}
        onConfirm={async () => {
          if (!pendingRepoDelete) return;
          setRepoDeletePending(true);
          setRepoDeleteError(null);
          try {
            await handleDeleteRepo(pendingRepoDelete.id);
          } catch (err) {
            // handleDeleteRepo throws on a non-OK response. RepoList's handler only opens this
            // dialog, so an uncaught error here just stops the spinner and says nothing.
            setRepoDeleteError(
              err instanceof Error ? err.message : "Could not remove this repository.",
            );
          } finally {
            setRepoDeletePending(false);
          }
        }}
        onCancel={() => {
          setPendingRepoDelete(null);
          setRepoDeleteError(null);
        }}
      />
    </>
  );
}
