import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MermaidBlock } from "../MermaidBlock";

describe("MermaidBlock controls", () => {
  it("offers a diagram/code toggle and a copy button, and hides the source by default", () => {
    const chart = 'graph LR\n  A[Frontend] -->|"HTTP Requests"|> B[Controller]';
    const html = renderToStaticMarkup(<MermaidBlock chart={chart} id="chart-1" />);

    expect(html).toContain("Show Mermaid source");
    expect(html).toContain("Copy to clipboard");
    expect(html).not.toContain("HTTP Requests");
  });

  it("shows a loader instead of the source while the diagram is still streaming", () => {
    const html = renderToStaticMarkup(
      <MermaidBlock chart="graph LR\n  A[Front" id="chart-2" streaming />,
    );

    expect(html).toContain("Waiting for diagram");
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("A[Front");
  });
});