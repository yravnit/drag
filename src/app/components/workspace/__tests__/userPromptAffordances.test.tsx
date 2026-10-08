// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MessageBubble } from "../MessageBubble";
import { Composer } from "../Composer";
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage } from "../types";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

const userMsg = (content: string): ChatMessage => ({
  id: "m1",
  role: "user",
  content,
  status: "completed",
});

const promptText = () => container?.querySelector("p") ?? null;
const buttonByText = (label: string) =>
  Array.from(container?.querySelectorAll("button") ?? []).find(
    (b) => b.textContent?.trim() === label,
  );

describe("user prompt affordances", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("puts a copy button under the prompt", () => {
    mount(
      <MessageBubble
        message={userMsg("What does OwnerRepository do?")}
        onCitationClick={() => {}}
      />,
    );
    const copy = container?.querySelector('button[title="Copy to clipboard"]');
    const prompt = promptText();
    expect(copy).toBeTruthy();
    expect(prompt).toBeTruthy();
    // "Under the prompt" = follows it in document order.
    const follows = !!(prompt!.compareDocumentPosition(copy!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows).toBe(true);
  });

  it("copies the whole prompt, not the clamped rendering", () => {
    const long = "x".repeat(900);
    mount(<MessageBubble message={userMsg(long)} onCitationClick={() => {}} />);
    act(() => {
      container?.querySelector<HTMLButtonElement>('button[title="Copy to clipboard"]')?.click();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(long);
  });

  it("leaves a short prompt whole, with no toggle", () => {
    mount(
      <MessageBubble
        message={userMsg("What does OwnerRepository do?")}
        onCitationClick={() => {}}
      />,
    );
    expect(promptText()?.className).not.toContain("line-clamp");
    expect(buttonByText("Show more")).toBeUndefined();
  });

  it("clamps a long prompt and reveals it on toggle", () => {
    const long = "y ".repeat(500);
    mount(<MessageBubble message={userMsg(long)} onCitationClick={() => {}} />);

    expect(promptText()?.className).toContain("line-clamp-6");
    const showMore = buttonByText("Show more")!;
    expect(showMore.getAttribute("aria-expanded")).toBe("false");

    act(() => showMore.click());
    expect(promptText()?.className).not.toContain("line-clamp");
    const showLess = buttonByText("Show less")!;
    expect(showLess.getAttribute("aria-expanded")).toBe("true");

    act(() => showLess.click());
    expect(promptText()?.className).toContain("line-clamp-6");
  });

  it("never clamps an assistant answer", () => {
    mount(
      <MessageBubble
        message={{ ...userMsg("z ".repeat(500)), role: "assistant" }}
        onCitationClick={() => {}}
      />,
    );
    expect(promptText()?.className).not.toContain("line-clamp");
    expect(buttonByText("Show more")).toBeUndefined();
  });
});

describe("composer message limit", () => {
  const mountComposer = (messageText: string) => {
    mount(
      <Composer
        messageText={messageText}
        isStreaming={false}
        chatError=""
        onMessageChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    return container?.querySelector("textarea");
  };

  it("caps the textarea at the limit the API enforces", () => {
    // Both read the one constant, so they cannot drift into a 400 the user can see.
    expect(MAX_CHAT_MESSAGE_LENGTH).toBe(4000);
    expect(mountComposer("")?.getAttribute("maxlength")).toBe("4000");
  });

  it("leaves the counter hidden until the prompt nears the limit", () => {
    mountComposer("a".repeat(100));
    expect(container?.textContent).not.toContain("left");
  });

  it("counts down the remaining characters near the limit", () => {
    mountComposer("a".repeat(MAX_CHAT_MESSAGE_LENGTH - 50));
    expect(container?.textContent).toContain("50 left");
  });
});
