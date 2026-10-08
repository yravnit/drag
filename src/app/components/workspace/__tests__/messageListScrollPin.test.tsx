// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MessageList } from "../MessageList";
import type { ChatMessage } from "../types";

/**
 * The stream-jump regression. `MessageList` used to pin with
 * `bottomRef.scrollIntoView({behavior:"smooth"})` on every `messages` change, which restarted the
 * animation per streamed chunk, aimed at a target measured before the content finished growing (so
 * it overshot the last line), scrolled every scrollable ancestor, and — because Chrome freezes
 * smooth-scroll animations in a backgrounded tab — resolved against a stale target on refocus.
 */
let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let frames: FrameRequestCallback[] = [];

function flushFrames() {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  frames = [];
  vi.restoreAllMocks();
});

function message(id: string, content: string): ChatMessage {
  return { id, role: "assistant", content, status: "completed" };
}

/** jsdom does no layout, so give the scroller a fixed geometry. */
function stubGeometry(el: HTMLElement, scrollHeight: number) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
  el.scrollTop = 0;
}

describe("MessageList bottom pinning", () => {
  it("pins by writing the container's own scrollTop, never scrollIntoView", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <MessageList
          messages={[message("m1", "one"), message("m2", "two")]}
          onCitationClick={() => {}}
        />,
      ),
    );

    const list = container.firstElementChild as HTMLElement;
    stubGeometry(list, 5000);
    act(() => flushFrames());

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(list.scrollTop).toBe(5000);
  });

  it("coalesces a burst of stream updates into a single scroll write", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const render = (messages: ChatMessage[]) =>
      act(() => root?.render(<MessageList messages={messages} onCitationClick={() => {}} />));

    render([message("m1", "a")]);
    const list = container.firstElementChild as HTMLElement;
    stubGeometry(list, 9000);

    // Three chunks land before any frame runs, as a real stream does.
    render([message("m1", "ab"), message("m1", "abc"), message("m1", "abcd")]);
    expect(frames).toHaveLength(1);

    act(() => flushFrames());
    expect(list.scrollTop).toBe(9000);
  });

  it("leaves a scrolled-up reader alone", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(<MessageList messages={[message("m1", "one")]} onCitationClick={() => {}} />),
    );
    const list = container.firstElementChild as HTMLElement;
    stubGeometry(list, 5000);
    // Settle the pin from the first render before pretending the reader scrolled away.
    act(() => flushFrames());

    list.scrollTop = 200; // far from the bottom
    act(() => list.dispatchEvent(new Event("scroll")));

    act(() =>
      root?.render(
        <MessageList
          messages={[message("m1", "one"), message("m2", "two")]}
          onCitationClick={() => {}}
        />,
      ),
    );
    expect(frames).toHaveLength(0);
    expect(list.scrollTop).toBe(200);
  });
});