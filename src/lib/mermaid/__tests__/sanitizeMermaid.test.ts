import { describe, it, expect } from "vitest";
import { sanitizeMermaidSvg } from "../sanitizeMermaid";

describe("sanitizeMermaidSvg", () => {
  it("preserves legitimate Mermaid SVG structures", () => {
    const legitimateSvg = `
      <svg id="mermaid-1" width="500" height="200" viewBox="0 0 500 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" />
          </marker>
        </defs>
        <g class="nodes">
          <g class="node" id="nodeA">
            <rect x="10" y="10" width="100" height="40" rx="5" ry="5" fill="#333" stroke="#555" />
            <text x="60" y="35" text-anchor="middle" fill="#fff">Start</text>
          </g>
          <g class="node" id="nodeB">
            <circle cx="200" cy="30" r="20" fill="#444" />
            <text x="200" y="35" text-anchor="middle" fill="#fff">End</text>
          </g>
        </g>
        <path d="M 110 30 L 180 30" stroke="#888" stroke-width="2" marker-end="url(#arrow)" />
      </svg>
    `.trim();

    const result = sanitizeMermaidSvg(legitimateSvg);

    expect(result).toContain("<svg");
    expect(result).toContain("rect");
    expect(result).toContain("circle");
    expect(result).toContain("Start");
    expect(result).toContain("End");
    expect(result).toContain("marker");
  });

  it("strips script tags from malicious SVG input", () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert('XSS')</script>
        <g><text>Safe Node</text></g>
      </svg>
    `;

    const result = sanitizeMermaidSvg(maliciousSvg);

    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert(");
    expect(result).toContain("Safe Node");
  });

  it("strips inline event handlers such as onload, onclick, and onerror", () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert('root')">
        <circle cx="10" cy="10" r="5" onclick="alert('click')" onmouseover="alert('hover')" />
        <image href="x" onerror="alert('error')" />
      </svg>
    `;

    const result = sanitizeMermaidSvg(maliciousSvg);

    expect(result).not.toContain("onload");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onmouseover");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert(");
  });

  it("strips javascript: URLs in hyperlinks", () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <a href="javascript:alert('pwned')">
          <text>Click Me</text>
        </a>
      </svg>
    `;

    const result = sanitizeMermaidSvg(maliciousSvg);

    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("alert(");
    expect(result).toContain("Click Me");
  });

  it("strips dangerous foreignObject with script and iframe tags", () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <foreignObject width="100" height="100">
          <body xmlns="http://www.w3.org/1999/xhtml">
            <iframe src="https://attacker.example.com"></iframe>
            <script>document.cookie</script>
          </body>
        </foreignObject>
      </svg>
    `;

    const result = sanitizeMermaidSvg(maliciousSvg);

    expect(result).not.toContain("iframe");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("attacker.example.com");
    expect(result).not.toContain("document.cookie");
  });

  it("handles empty or non-string input gracefully", () => {
    expect(sanitizeMermaidSvg("")).toBe("");
    expect(sanitizeMermaidSvg(null as unknown as string)).toBe("");
    expect(sanitizeMermaidSvg(undefined as unknown as string)).toBe("");
  });
});
