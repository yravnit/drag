import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { normalizeMermaid } from "../normalizeMermaid";

type Mermaid = {
  parse: (text: string) => Promise<unknown>;
  initialize?: (config: Record<string, unknown>) => void;
};
let mermaid: Mermaid;

beforeAll(async () => {
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  mermaid = ((await import("mermaid")) as { default: Mermaid }).default;
  mermaid.initialize?.({ startOnLoad: false, securityLevel: "strict" });
});

async function parses(text: string): Promise<boolean> {
  try {
    await mermaid.parse(text);
    return true;
  } catch {
    return false;
  }
}

describe("normalizeMermaid", () => {
  it("quotes an unquoted edge label starting with @ so the chart parses", async () => {
    const chart = `flowchart TD
  SDOwner -->|@Query: LEFT JOIN Foo| ChatWindow
  ChatWindow --> RAG`;

    expect(await parses(chart)).toBe(false);
    expect(normalizeMermaid(chart)).toBe(`flowchart TD
  SDOwner -->|"@Query: LEFT JOIN Foo"| ChatWindow
  ChatWindow --> RAG`);
    expect(await parses(normalizeMermaid(chart))).toBe(true);
  });

  it("quotes labels containing parentheses or quotes", async () => {
    expect(normalizeMermaid("flowchart LR\n  A -->|LEFT JOIN (Foo)| B")).toBe(
      'flowchart LR\n  A -->|"LEFT JOIN (Foo)"| B',
    );
  });

  it("leaves already quoted labels untouched", () => {
    const chart = 'flowchart LR\n  A -->|"@Query: x"| B';
    expect(normalizeMermaid(chart)).toBe(chart);
  });

  it("never turns a chart that already parses into one that does not", async () => {
    const chart = `flowchart LR
  A[(db)] -->|uses| B{round}
  B --> C
  C -.->|cached| D
  E ==>|hit| F
  classDef hot fill:#f00`;

    expect(await parses(chart)).toBe(true);
    expect(await parses(normalizeMermaid(chart))).toBe(true);
  });

  it("does not touch pipes outside edge labels", () => {
    const nodeText = "flowchart LR\n  A[a|b|c] --> B";
    expect(normalizeMermaid(nodeText)).toBe(nodeText);

    const erCardinality = "erDiagram\n  CUSTOMER ||--o{ ORDER : places";
    expect(normalizeMermaid(erCardinality)).toBe(erCardinality);
  });

  it("drops the stray |> the model appended to a quoted edge label", async () => {
    const chart = `graph LR
    A[Frontend] -->|"HTTP Requests"|> B[Spring MVC Controller]
    B -->|"Business Logic"|> C[Service Layer]`;

    expect(await parses(chart)).toBe(false);
    expect(normalizeMermaid(chart)).toBe(`graph LR
    A[Frontend] -->|"HTTP Requests"| B[Spring MVC Controller]
    B -->|"Business Logic"| C[Service Layer]`);
    expect(await parses(normalizeMermaid(chart))).toBe(true);
  });

  it("drops the stray |> after quoting an unquoted label", () => {
    expect(normalizeMermaid("graph LR\n  A -->|HTTP Requests|> B")).toBe(
      'graph LR\n  A -->|"HTTP Requests"| B',
    );
  });

  it("drops the model's hand-painted styling so the house theme shows through", async () => {
    const chart = `graph LR
    A[Frontend] -->|"HTTP Requests"|> B[Controller]
    style A fill:#f9f,stroke:#333,stroke-width:2px
    classDef hot fill:#f00
    class B hot
    linkStyle 0 stroke:#0f0`;

    expect(await parses(chart)).toBe(false);
    const normalized = normalizeMermaid(chart);
    expect(normalized).not.toContain("fill:#f9f");
    expect(normalized).not.toContain("classDef");
    expect(normalized).not.toContain("linkStyle");
    expect(normalized).toContain('A[Frontend] -->|"HTTP Requests"| B[Controller]');
    expect(normalized).toContain("class B hot");
    expect(await parses(normalized)).toBe(true);
  });

  it("strips %%{init} theme overrides so the house theme cannot be replaced", async () => {
    const chart = `%%{init: {"themeVariables": {"primaryColor": "#f9f"}, "htmlLabels": true}}%%
flowchart TD
  A[Frontend] --> B[Backend]`;

    const normalized = normalizeMermaid(chart);

    expect(normalized).not.toContain("%%{");
    expect(normalized).not.toContain("#f9f");
    expect(normalized).not.toContain("htmlLabels");
    expect(await parses(normalized)).toBe(true);
  });

  it("strips leading YAML frontmatter config", async () => {
    const chart = `---
config:
  theme: dark
  themeVariables:
    primaryColor: "#f9f"
---
flowchart TD
  A[Frontend] --> B[Backend]`;

    const normalized = normalizeMermaid(chart);

    expect(normalized).not.toContain("themeVariables");
    expect(normalized).not.toContain("#f9f");
    expect(normalized).toContain("flowchart TD");
    expect(await parses(normalized)).toBe(true);
  });

  it("keeps classDiagram member blocks that open with class", async () => {
    const chart = `classDiagram
  class Owner {
    +name()
  }
  Owner --> Pet`;

    expect(normalizeMermaid(chart)).toBe(chart);
    expect(await parses(normalizeMermaid(chart))).toBe(true);
  });

  it("treats $ sequences in labels literally", () => {
    expect(normalizeMermaid("flowchart LR\n  A -->|$1 and $&| B")).toBe(
      'flowchart LR\n  A -->|"$1 and $&"| B',
    );
  });
});
