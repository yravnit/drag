// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const initialize = vi.fn<(config: unknown) => void>();
const render = vi.fn(async (_id: string, _chart: string) => ({
  svg: "<svg><text>ok</text></svg>",
}));

vi.mock("mermaid", () => ({
  default: {
    initialize,
    render,
  },
}));

import { MermaidBlock } from "../MermaidBlock";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

beforeEach(() => {
  initialize.mockClear();
  render.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function mount(props: { chart: string; id: string; streaming?: boolean }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<MermaidBlock {...props} />);
  });
}

describe("MermaidBlock configuration", () => {
  it("initializes strict security with native SVG labels, and skips the render while streaming", async () => {
    await mount({ chart: "graph LR\n  A --> B", id: "c1", streaming: true });
    expect(initialize).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    await mount({ chart: "graph LR\n  A --> B", id: "c1" });

    expect(initialize).toHaveBeenCalledTimes(1);
    const config = initialize.mock.calls[0]?.[0] as {
      securityLevel?: string;
      htmlLabels?: boolean;
      flowchart?: { htmlLabels?: boolean };
    };
    // `securityLevel` keeps Mermaid's own sanitizer on. `htmlLabels: false` is the paired half:
    // the default labels are <foreignObject> HTML, which `sanitizeMermaidSvg` strips wholesale,
    // so flipping either setting alone renders unlabeled boxes.
    expect(config.securityLevel).toBe("strict");
    expect(config.htmlLabels).toBe(false);
    expect(config.flowchart?.htmlLabels).toBe(false);
  });

  it("normalizes the chart source before handing it to Mermaid", async () => {
    const chart = 'graph LR\n  A -->|"HTTP Requests"|> B';
    await mount({ chart, id: "c2" });

    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[1]).not.toContain("|>");
  });
});
