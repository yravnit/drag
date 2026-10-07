// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

/** Records the id MermaidBlock was handed on every render, so a re-render can be compared. */
const receivedIds: string[] = [];
vi.mock("../MermaidBlock", () => ({
  MermaidBlock: ({ id }: { id: string }) => {
    receivedIds.push(id);
    return React.createElement("div", { "data-testid": "mermaid" }, id);
  },
}));

import { MessageRenderer } from "../MessageRenderer";

const CHART = "graph LR\n  A[Frontend] --> B[Backend]";
const MARKDOWN = `Diagram:\n\n\`\`\`mermaid\n${CHART}\n\`\`\``;

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    render: (content: string) =>
      act(() => {
        root.render(<MessageRenderer content={content} onCitationClick={vi.fn()} />);
      }),
    unmount: () => act(() => root.unmount()),
  };
}

describe("Mermaid diagram identity", () => {
  beforeEach(() => {
    receivedIds.length = 0;
  });

  it("keeps the same diagram id when the message re-renders", () => {
    const view = mount();
    view.render(MARKDOWN);
    view.render(MARKDOWN);
    view.unmount();

    expect(receivedIds.length).toBeGreaterThanOrEqual(2);
    // A per-render random id gave MermaidBlock a new dependency every time, so it cleared and
    // re-rendered finished diagrams: visible flicker and repeated work on every stream token.
    expect(new Set(receivedIds).size).toBe(1);
  });

  it("gives different diagrams different ids within one message", () => {
    const twoCharts =
      "```mermaid\ngraph LR\n  A --> B\n```\n\n```mermaid\ngraph TD\n  C --> D\n```";
    const view = mount();
    view.render(twoCharts);
    view.unmount();

    expect(receivedIds).toHaveLength(2);
    expect(receivedIds[0]).not.toBe(receivedIds[1]);
  });
});
