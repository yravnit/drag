/**
 * A `|label|` edge label anchored directly after a link token (`-->`, `---`,
 * `-.->`, `==>`, `--x`, `<-->`, ...). Anchoring on the link token rather than the
 * line keeps pipes in node text (`A[a|b|c] --> B`) and `erDiagram` cardinality
 * (`CUSTOMER ||--o{ ORDER`) untouched. The label class excludes `|` and `"`, so
 * already-quoted labels never match.
 */
const PIPE_EDGE_LABEL = /(<?[-=.]{2,}[xo]?>?\s*)\|([^|"\n]*)\|/g;

/**
 * A `|>` the model appended to the closing pipe of an edge label, e.g.
 * `A -->|"HTTP Requests"|> B`. `|>` is a stateDiagram transition token, not a
 * flowchart link, so the lexer aborts with `Expecting ... got 'TAGEND'`. The
 * link token already carries the arrow, so the stray `>` is dropped.
 */
const STRAY_LABEL_ARROW = /(<?[-=.]{2,}[xo]?>?\s*\|[^|\n]*\|)>/g;

/**
 * Whole lines the model uses to hand-paint a chart: `style A fill:#f9f,stroke:#333`,
 * `classDef hot fill:#f00`, `linkStyle 0 stroke:#f00`. These become inline `style=`
 * attributes that no stylesheet can override without `!important`, so keeping them
 * makes every diagram look different. They are dropped for a single house look.
 *
 * `class <ids> <name>` is deliberately NOT dropped: it opens a member block in
 * `classDiagram`, and an orphaned reference with no `classDef` still parses.
 */
const MODEL_STYLING = /^[ \t]*(?:style|classDef|linkStyle)\s+\S+.*$/gm;

/**
 * Repairs Mermaid charts the model wrote but Mermaid cannot parse, then strips the
 * model's hand-painted styling so every diagram renders with the house theme.
 *
 * `A -->|@Query: LEFT JOIN Foo| B` fails to parse: inside `|...|` the lexer emits
 * `LINK_ID` for a leading `@` and `BRKT` for `(`, `)`, or `"`, none of which the
 * edge-label rule accepts. Quoting the label (`A -->|"@Query: LEFT JOIN Foo"| B`)
 * is always valid, so labels are quoted before rendering.
 *
 * Replacement goes through a function so `$` sequences in LLM output are not
 * treated as replacement patterns.
 */
export function normalizeMermaid(chart: string): string {
  return chart
    .replace(PIPE_EDGE_LABEL, (match, arrow: string, label: string) =>
      label.length === 0 ? match : `${arrow}|"${label}"|`,
    )
    .replace(STRAY_LABEL_ARROW, "$1")
    .replace(MODEL_STYLING, "");
}