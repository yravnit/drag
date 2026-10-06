// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MessageBubble } from "../MessageBubble";
import type { ChatMessage, Citation } from "../types";

const citations: Citation[] = [
  {
    index: 1,
    filePath: "src/lib/ingestion/fileFilter.ts",
    startLine: 10,
    endLine: 24,
    symbolName: "isIgnored",
    text: "export function isIgnored(path: string) {\n  return true;\n}",
  },
  {
    index: 2,
    filePath: "src/lib/retrieval/retriever.ts",
    startLine: 30,
    endLine: 44,
    symbolName: null,
    text: "export async function retrieve() {}",
  },
];

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function renderMessage(message: ChatMessage, onCitationClick: () => void) {
  act(() => root?.unmount());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<MessageBubble message={message} onCitationClick={onCitationClick} />);
  });
}

function clickButtons(prefix: string): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll("button") ?? []).filter((b) =>
    b.getAttribute("title")?.startsWith(prefix),
  );
}

describe("citation click opens the citation drawer", () => {
  it("renders a clickable marker for citations written inside list items", () => {
    renderMessage(
      {
        id: "m1",
        role: "assistant",
        content: "- Secrets are dropped by the filter [1]\n- Ranking happens in the retriever [2]",
        status: "completed",
        citations,
      },
      () => {},
    );

    const markers = clickButtons("View citation");
    expect(markers).toHaveLength(2);
    expect(markers[0].getAttribute("title")).toContain("src/lib/ingestion/fileFilter.ts");
  });

  it("calls onCitationClick with the matching citation when a table-cell marker is clicked", () => {
    const onCitationClick = vi.fn();
    renderMessage(
      {
        id: "m2",
        role: "assistant",
        content: "| File | Role |\n| --- | --- |\n| retriever.ts | ranking [2] |",
        status: "completed",
        citations,
      },
      onCitationClick,
    );

    const marker = clickButtons("View citation [2]")[0];
    expect(marker).toBeDefined();

    act(() => {
      marker.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCitationClick).toHaveBeenCalledTimes(1);
    expect(onCitationClick.mock.calls[0][0]).toMatchObject({
      index: 2,
      filePath: "src/lib/retrieval/retriever.ts",
    });
  });

  it("lists every cited file as a clickable source chip even without inline markers", () => {
    const onCitationClick = vi.fn();
    renderMessage(
      {
        id: "m3",
        role: "assistant",
        content: "The filter drops secrets before chunking.",
        status: "completed",
        citations,
      },
      onCitationClick,
    );

    expect(container?.textContent).toContain("Sources");

    const chip = clickButtons("src/lib/ingestion/fileFilter.ts:10-24")[0];
    expect(chip).toBeDefined();

    act(() => {
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCitationClick).toHaveBeenCalledWith(citations[0]);
  });

  it("does not render sources for user messages", () => {
    renderMessage(
      {
        id: "m4",
        role: "user",
        content: "How is filtering done?",
        status: "completed",
        citations,
      },
      () => {},
    );

    expect(container?.textContent).not.toContain("Sources");
  });
});