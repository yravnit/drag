import DOMPurify from "dompurify";

let nodePurifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (typeof window !== "undefined") {
    if (typeof (DOMPurify as unknown as (win: unknown) => ReturnType<typeof DOMPurify>) === "function") {
      return (DOMPurify as unknown as (win: unknown) => ReturnType<typeof DOMPurify>)(window);
    }
    return DOMPurify;
  }

  if (!nodePurifier) {
    // In Node or test runner environments without native window, use jsdom
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM("");
    nodePurifier = (DOMPurify as unknown as (win: unknown) => ReturnType<typeof DOMPurify>)(dom.window);
  }

  return nodePurifier;
}

/**
 * Sanitizes rendered Mermaid SVG diagrams.
 * Removes malicious script tags, event handlers, and active javascript schemes
 * while preserving valid SVG presentation elements and filters.
 *
 * Must stay in sync with `MermaidBlock`: Mermaid renders labels as `<foreignObject>`
 * wrapping HTML by default, and DOMPurify drops `foreignObject` entirely, which
 * yields unlabeled boxes. Mermaid is therefore configured with `htmlLabels: false`
 * so labels are native SVG `<text>` and the SVG-only profile is sufficient.
 */
export function sanitizeMermaidSvg(svg: string): string {
  if (!svg || typeof svg !== "string") {
    return "";
  }

  const purifier = getPurifier();
  return purifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
  });
}
