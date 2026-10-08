"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Code2, Eye, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { sanitizeMermaidSvg } from "@/lib/mermaid/sanitizeMermaid";
import { normalizeMermaid } from "@/lib/mermaid/normalizeMermaid";
import { CopyCodeButton } from "./CopyCodeButton";
import { highlightCode } from "@/lib/highlight";

interface MermaidBlockProps {
  chart: string;
  id: string;
  streaming?: boolean;
  /** Header label. The markdown pipeline has no title to pass, so this stays at the default. */
  title?: string;
}

/**
 * Single house look for every diagram. Model-authored `style`/`classDef` lines are
 * stripped by `normalizeMermaid`, so nothing here has to fight inline `style=`
 * attributes on the rendered nodes.
 */
const THEME = {
  theme: "base",
  themeVariables: {
    background: "#0a0a0a",
    primaryColor: "#18181b",
    primaryTextColor: "#e4e4e7",
    primaryBorderColor: "#3f3f46",
    secondaryColor: "#18181b",
    secondaryBorderColor: "#3f3f46",
    tertiaryColor: "#0a0a0a",
    lineColor: "#71717a",
    textColor: "#e4e4e7",
    mainBkg: "#18181b",
    nodeBorder: "#3f3f46",
    clusterBkg: "#09090b",
    clusterBorder: "#27272a",
    edgeLabelBackground: "#0a0a0a",
    fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif",
    fontSize: "14px",
  },
} as const;

const ZOOMS = [0.5, 0.75, 1, 1.5, 2] as const;
const DEFAULT_ZOOM = 2;

/**
 * Client-side Mermaid diagram renderer.
 * Renders the diagram by default and can toggle to the Mermaid source; a chart that
 * fails to compile falls back to the source view plus the parser message.
 */
export function MermaidBlock({
  chart,
  id,
  streaming = false,
  title = "Architecture Diagram",
}: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>("");
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [error, setError] = useState<string>("");
  const [showCode, setShowCode] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    // A half-streamed diagram is not valid Mermaid, so rendering it just flashes a broken
    // diagram and then the source plus a parse error. Wait for the closing fence instead.
    if (streaming) return;

    let active = true;
    setError("");
    import("mermaid")
      .then((m) => {
        if (!active) return;
        m.default.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Native SVG <text> labels. The default HTML labels are <foreignObject>
          // wrappers, which DOMPurify removes wholesale, leaving unlabeled boxes.
          htmlLabels: false,
          flowchart: { htmlLabels: false, curve: "basis", nodeSpacing: 45, rankSpacing: 55 },
          ...THEME,
        });
        m.default
          .render(`mermaid-${id}`, normalizeMermaid(chart))
          .then(({ svg: renderedSvg }) => {
            if (!active) return;
            const clean = sanitizeMermaidSvg(renderedSvg);
            setSvg(clean);
            // Mermaid emits width="100%", which shrinks wide charts into unreadable
            // thumbnails. Its inline max-width is the natural width, so use it as a
            // floor and let the block scroll.
            setNaturalWidth(Number(clean.match(/max-width:\s*([\d.]+)px/)?.[1]) || 0);
          })
          .catch((err: unknown) => {
            console.error("Mermaid render error:", err);
            if (active) setError(message(err));
          });
      })
      .catch((err: unknown) => {
        console.error("Mermaid import error:", err);
        if (active) setError(message(err));
      });

    return () => {
      active = false;
    };
  }, [chart, id, streaming]);

  const showDiagram = !showCode && !error;
  const zoom = ZOOMS[zoomIdx];
  const pending = streaming || !svg;

  return (
    <div className="my-3.5 overflow-hidden rounded-card border border-chat-line bg-chat-2 shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-chat-line bg-chat-3 px-3.5 py-2">
        <span className="rounded-[6px] bg-accent-soft px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-accent-ink">
          Diagram
        </span>
        <span className="text-[12.5px] font-bold tracking-[-0.02em] text-chat-ink">{title}</span>

        <div className="ml-auto flex items-center gap-1.5">
          {!error && (
            <button
              type="button"
              onClick={() => setShowCode((prev) => !prev)}
              aria-pressed={showCode}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-chat-line bg-chat-2 px-2 py-1 text-[11.5px] font-semibold text-chat-ink-2 transition-colors duration-150 hover:border-accent hover:bg-chat-3 hover:text-chat-ink active:scale-[0.96]"
              title={showCode ? "Show diagram" : "Show Mermaid source"}
            >
              {showCode ? (
                <Eye className="size-3" aria-hidden />
              ) : (
                <Code2 className="size-3" aria-hidden />
              )}
              <span>{showCode ? "Diagram" : "Code"}</span>
            </button>
          )}

          {showDiagram && !pending && (
            <>
              <IconButton
                size="sm"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={zoomIdx === 0}
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              >
                <ZoomOut className="size-3" aria-hidden />
              </IconButton>
              <button
                type="button"
                onClick={() => setZoomIdx(DEFAULT_ZOOM)}
                title="Reset zoom"
                className="min-w-[42px] cursor-pointer rounded-[6px] border border-chat-line bg-chat-2 px-2 py-1 text-[11.5px] font-semibold tabular-nums text-chat-ink-2 transition-colors duration-150 hover:border-accent hover:bg-chat-3 hover:text-chat-ink"
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton
                size="sm"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={zoomIdx === ZOOMS.length - 1}
                onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
              >
                <ZoomIn className="size-3" aria-hidden />
              </IconButton>
            </>
          )}

          <CopyCodeButton text={chart} />
        </div>
      </div>

      {showDiagram ? (
        svg ? (
          <div className="overflow-x-auto bg-[#0a0a0a] p-4">
            <div
              className="mermaid-figure mx-auto"
              style={{ zoom, minWidth: naturalWidth || undefined }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        ) : (
          <div
            className="flex min-h-[10rem] flex-col items-center justify-center gap-2 bg-[#0a0a0a] p-6"
            role="status"
            aria-live="polite"
            aria-label={streaming ? "Waiting for diagram" : "Rendering diagram"}
          >
            <Loader2 className="size-6 animate-spin text-zinc-500" />
            <span className="font-mono text-[11px] text-zinc-600">
              {streaming ? "waiting for diagram…" : "rendering…"}
            </span>
          </div>
        )
      ) : (
        <>
          {error && (
            <div
              className="flex items-start gap-1.5 border-b border-chat-line bg-danger-soft px-4 py-2 text-[11px] text-danger"
              title={error}
            >
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span className="break-words font-sans">{error.split("\n")[0]}</span>
            </div>
          )}
          <div className="p-3">
            <pre className="m-0 overflow-x-auto">
              <code className="code-surface block rounded-[10px] p-3.5 text-[12px] leading-[1.6]">
                {highlightCode(chart).map((nodes, index) => (
                  <span key={index} className="block">
                    {nodes}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        </>
      )}
    </div>
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
