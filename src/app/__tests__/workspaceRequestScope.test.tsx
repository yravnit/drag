// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const mockUseSession = vi.fn();

type Message = { id: string; content: string };

/** The subset of WorkspaceShell props these tests drive. */
interface ShellProps {
  conversations: Array<{ id: string; title: string; repositoryId: string }>;
  messages: Message[];
  messagesLoading: boolean;
  convsLoading: boolean;
  onSelectRepo: (repo: unknown) => void;
  onSelectConversation: (conv: unknown) => void;
  onMessageChange: (text: string) => void;
  onSendMessage: (event: unknown) => Promise<void>;
  onEditMessage?: (content: string, messageId?: string) => void;
}

/** Props the workspace shell last received, so tests can drive selection directly. */
let shellProps = {} as ShellProps;

vi.mock("@/lib/auth/client", () => ({
  useSession: () => mockUseSession(),
  signIn: { social: vi.fn() },
  signOut: vi.fn(),
}));

vi.mock("../components/workspace/WorkspaceShell", () => ({
  WorkspaceShell: (props: unknown) => {
    shellProps = props as ShellProps;
    return null;
  },
}));

vi.mock("../components/workspace/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

import Home from "../workspace/page";

type Route = () => Promise<unknown>;

let routes: Record<string, Route>;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

/** A promise the test resolves by hand, so an in-flight request can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const REPO_ONE = { id: "repo-1", owner: "a", name: "one", defaultBranch: "main" };
const REPO_TWO = { id: "repo-2", owner: "a", name: "two", defaultBranch: "main" };

beforeEach(() => {
  routes = {};
  shellProps = {} as ShellProps;
  mockUseSession.mockReturnValue({
    data: { user: { id: "u1", name: "n", email: "e", image: null } },
    isPending: false,
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      const route = routes[path];
      if (!route) throw new Error(`unrouted fetch: ${url}`);
      return { ok: true, json: async () => route() } as unknown as Response;
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(<Home />);
  });
}

function stubCommonRoutes() {
  routes["/api/repos"] = async () => [REPO_ONE, REPO_TWO];
  routes["/api/user/plan"] = async () => ({
    plan: "free",
    entitlements: {},
    usage: {},
  });
  routes["/api/auth/access-mode"] = async () => ({ accessMode: "full" });
  routes["/api/repos/repo-1/status"] = async () => ({ id: "repo-1", embeddingStatus: "ready" });
  routes["/api/repos/repo-2/status"] = async () => ({ id: "repo-2", embeddingStatus: "ready" });
}

describe("workspace request scoping", () => {
  it("keeps the conversation load alive when selecting a repository clears the thread", async () => {
    stubCommonRoutes();

    const held = deferred<unknown>();
    let conversationCalls = 0;
    routes["/api/conversations"] = async () => {
      conversationCalls++;
      // The load for the newly selected repository is held open while the message effect for the
      // cleared thread runs. A shared request counter discarded this response and left
      // `convsLoading` stuck on.
      return conversationCalls === 1 ? held.promise : [];
    };
    routes["/api/conversations/convo-1/messages"] = async () => [];

    await mount();

    await act(async () => {
      shellProps.onSelectRepo(REPO_ONE);
    });

    // The repository effect cleared `selectedConversation`, which ran the message effect. The
    // conversation request must still be the current one.
    expect(conversationCalls).toBe(1);

    await act(async () => {
      held.resolve([{ id: "convo-1", title: "Thread one", repositoryId: "repo-1" }]);
    });

    expect(shellProps.conversations).toHaveLength(1);
    expect(shellProps.convsLoading).toBe(false);
  });

  it("does not strand the current thread when a superseded stream finishes", async () => {
    stubCommonRoutes();
    routes["/api/conversations"] = async () => [
      { id: "convo-1", title: "Thread one", repositoryId: "repo-1" },
      { id: "convo-2", title: "Thread two", repositoryId: "repo-1" },
    ];
    routes["/api/conversations/convo-1/messages"] = async () => [
      { id: "m1", role: "user", content: "first thread" },
    ];
    routes["/api/conversations/convo-2/messages"] = async () => [
      { id: "m2", role: "user", content: "second thread" },
    ];

    const streamDone = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (path === "/api/chat") {
          return {
            ok: true,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("answer"));
                void streamDone.promise.then(() => controller.close());
              },
            }),
          } as unknown as Response;
        }
        const route = routes[path];
        if (!route) throw new Error(`unrouted fetch: ${url}`);
        void init;
        return { ok: true, json: async () => route() } as unknown as Response;
      }),
    );

    await mount();
    await act(async () => {
      shellProps.onSelectRepo(REPO_ONE);
    });
    await act(async () => {
      shellProps.onSelectConversation({ id: "convo-2", title: "Thread two", repositoryId: "repo-1" });
    });

    // Not awaited: the send only settles once the stream closes, which is released below.
    await act(async () => {
      shellProps.onMessageChange("ask something");
    });
    await act(async () => {
      void shellProps.onSendMessage({ preventDefault: () => {} });
    });

    // The user moves to another thread while the answer is still streaming.
    await act(async () => {
      shellProps.onSelectConversation({ id: "convo-1", title: "Thread one", repositoryId: "repo-1" });
    });
    expect(shellProps.messagesLoading).toBe(false);

    await act(async () => {
      streamDone.resolve();
    });

    // The stream's completion reloads its own (now stale) thread. That call must be rejected
    // before it sets loading state, or this thread shows a spinner forever.
    expect(shellProps.messagesLoading).toBe(false);
    expect(shellProps.messages.map((m) => m.content)).toEqual(["first thread"]);
  });

  it("does not reload old repository conversations when repository is switched during stream", async () => {
    stubCommonRoutes();
    const repo1Convs = [{ id: "c1", title: "Repo 1 Thread", repositoryId: "repo-1" }];
    const repo2Convs = [{ id: "c2", title: "Repo 2 Thread", repositoryId: "repo-2" }];

    let repo1FetchCount = 0;
    routes["/api/conversations"] = async () => repo1Convs;
    routes["/api/conversations/c1/messages"] = async () => [];

    const streamDone = deferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const fullUrl = String(url);
        const path = fullUrl.split("?")[0];
        if (path === "/api/chat") {
          return {
            ok: true,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("streaming answer"));
                void streamDone.promise.then(() => controller.close());
              },
            }),
          } as unknown as Response;
        }
        if (path === "/api/conversations") {
          if (fullUrl.includes("repositoryId=repo-1")) {
            repo1FetchCount++;
            return { ok: true, json: async () => repo1Convs } as unknown as Response;
          }
          if (fullUrl.includes("repositoryId=repo-2")) {
            return { ok: true, json: async () => repo2Convs } as unknown as Response;
          }
        }
        const route = routes[path];
        if (!route) throw new Error(`unrouted fetch: ${url}`);
        void init;
        return { ok: true, json: async () => route() } as unknown as Response;
      }),
    );

    await mount();
    await act(async () => {
      shellProps.onSelectRepo(REPO_ONE);
    });
    await act(async () => {
      shellProps.onSelectConversation(repo1Convs[0]);
    });

    await act(async () => {
      shellProps.onMessageChange("hello world");
    });
    await act(async () => {
      void shellProps.onSendMessage({ preventDefault: () => {} });
    });

    expect(repo1FetchCount).toBe(1);

    // Switch to REPO_TWO while stream is in flight
    await act(async () => {
      shellProps.onSelectRepo(REPO_TWO);
    });

    expect(shellProps.conversations).toEqual(repo2Convs);

    // Complete the stream
    await act(async () => {
      streamDone.resolve();
    });

    // Old repo 1 conversations should not have been re-fetched or replaced repo 2's list
    expect(repo1FetchCount).toBe(1);
    expect(shellProps.conversations).toEqual(repo2Convs);
  });

  it("does not roll back a newer successful edit when an earlier overlapping edit fails", async () => {
    stubCommonRoutes();
    const repo1Convs = [{ id: "convo-1", title: "Thread one", repositoryId: "repo-1" }];
    const initialMessages = [
      { id: "msg-1", role: "user", content: "Original prompt", status: "completed" },
    ];
    routes["/api/conversations"] = async () => repo1Convs;
    routes["/api/conversations/convo-1/messages"] = async () => initialMessages;

    const patch1 = deferred<{ ok: boolean; status: number }>();
    const patch2 = deferred<{ ok: boolean; status: number }>();
    let patchCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const fullUrl = String(url);
        const path = fullUrl.split("?")[0];
        if (init?.method === "PATCH") {
          patchCount++;
          if (patchCount === 1) {
            const res = await patch1.promise;
            return { ok: res.ok, status: res.status, json: async () => ({}) } as unknown as Response;
          }
          if (patchCount === 2) {
            const res = await patch2.promise;
            return { ok: res.ok, status: res.status, json: async () => ({}) } as unknown as Response;
          }
        }
        const route = routes[path];
        if (!route) throw new Error(`unrouted fetch: ${url}`);
        return { ok: true, json: async () => route() } as unknown as Response;
      }),
    );

    await mount();
    await act(async () => {
      shellProps.onSelectRepo(REPO_ONE);
    });
    await act(async () => {
      shellProps.onSelectConversation(repo1Convs[0]);
    });

    expect(shellProps.messages[0].content).toBe("Original prompt");

    // First edit: "Prompt edit 1" (held open in patch1)
    await act(async () => {
      void shellProps.onEditMessage?.("Prompt edit 1", "msg-1");
    });
    expect(shellProps.messages[0].content).toBe("Prompt edit 1");

    // Second edit while first is pending: "Prompt edit 2" (held open in patch2)
    await act(async () => {
      void shellProps.onEditMessage?.("Prompt edit 2", "msg-1");
    });
    expect(shellProps.messages[0].content).toBe("Prompt edit 2");

    // Second edit succeeds
    await act(async () => {
      patch2.resolve({ ok: true, status: 200 });
    });
    expect(shellProps.messages[0].content).toBe("Prompt edit 2");

    // First edit subsequently fails
    await act(async () => {
      patch1.resolve({ ok: false, status: 500 });
    });

    // Stale rollback should NOT restore "Original prompt"
    expect(shellProps.messages[0].content).toBe("Prompt edit 2");
  });

  it("does not roll back a newer successful edit when an earlier overlapping edit suffers a network error", async () => {
    stubCommonRoutes();
    const repo1Convs = [{ id: "convo-1", title: "Thread one", repositoryId: "repo-1" }];
    const initialMessages = [
      { id: "msg-1", role: "user", content: "Original prompt", status: "completed" },
    ];
    routes["/api/conversations"] = async () => repo1Convs;
    routes["/api/conversations/convo-1/messages"] = async () => initialMessages;

    const patch1 = deferred<{ ok: boolean; status: number }>();
    const patch2 = deferred<{ ok: boolean; status: number }>();
    let patchCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const fullUrl = String(url);
        const path = fullUrl.split("?")[0];
        if (init?.method === "PATCH") {
          patchCount++;
          if (patchCount === 1) {
            await patch1.promise;
            throw new Error("Network connection dropped");
          }
          if (patchCount === 2) {
            const res = await patch2.promise;
            return { ok: res.ok, status: res.status, json: async () => ({}) } as unknown as Response;
          }
        }
        const route = routes[path];
        if (!route) throw new Error(`unrouted fetch: ${url}`);
        return { ok: true, json: async () => route() } as unknown as Response;
      }),
    );

    await mount();
    await act(async () => {
      shellProps.onSelectRepo(REPO_ONE);
    });
    await act(async () => {
      shellProps.onSelectConversation(repo1Convs[0]);
    });

    expect(shellProps.messages[0].content).toBe("Original prompt");

    // First edit: "Prompt edit 1" (held open in patch1)
    await act(async () => {
      void shellProps.onEditMessage?.("Prompt edit 1", "msg-1");
    });
    expect(shellProps.messages[0].content).toBe("Prompt edit 1");

    // Second edit while first is pending: "Prompt edit 2" (held open in patch2)
    await act(async () => {
      void shellProps.onEditMessage?.("Prompt edit 2", "msg-1");
    });
    expect(shellProps.messages[0].content).toBe("Prompt edit 2");

    // Second edit succeeds
    await act(async () => {
      patch2.resolve({ ok: true, status: 200 });
    });
    expect(shellProps.messages[0].content).toBe("Prompt edit 2");

    // First edit subsequently rejects with network error
    await act(async () => {
      patch1.resolve({ ok: false, status: 0 });
    });

    // Stale network-error rollback should NOT restore "Original prompt"
    expect(shellProps.messages[0].content).toBe("Prompt edit 2");
  });
});