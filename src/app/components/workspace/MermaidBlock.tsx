"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Code2, Eye, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { sanitizeMermaidSvg } from "@/lib/mermaid/sanitizeMermaid";
import { normalizeMermaid } from "@/lib/mermaid/normalizeMermaid";
import { CopyCodeButton } from "./CopyCodeButton";

interface MermaidBlockProps {
  chart: string;
  id: string;
  streaming?: boolean;
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
    fontFamily: "var(--font-manrope)",
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
export function MermaidBlock({ chart, id, streaming = false }: MermaidBlockProps) {
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
    <div className="my-3 rounded-lg overflow-hidden border border-zinc-800">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-zinc-900 text-xs text-zinc-400 font-mono border-b border-zinc-800">
        <span className="mr-auto">mermaid</span>
        {pending && <span className="text-zinc-500">rendering…</span>}
        {showDiagram && !pending && (
          <>
            <ZoomButton
              label="Zoom out"
              disabled={zoomIdx === 0}
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            >
              <ZoomOut className="h-3 w-3" />
            </ZoomButton>
            <button
              type="button"
              onClick={() => setZoomIdx(DEFAULT_ZOOM)}
              title="Reset zoom"
              className="px-1.5 py-0.5 rounded text-[11px] tabular-nums hover:text-zinc-200 hover:bg-zinc-800 transition active:scale-95 cursor-pointer"
            >
              {Math.round(zoom * 100)}%
            </button>
            <ZoomButton
              label="Zoom in"
              disabled={zoomIdx === ZOOMS.length - 1}
              onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
            >
              <ZoomIn className="h-3 w-3" />
            </ZoomButton>
          </>
        )}
        {!error && (
          <button
            type="button"
            onClick={() => setShowCode((prev) => !prev)}
            aria-pressed={showCode}
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition active:scale-95 px-2 py-0.5 rounded hover:bg-zinc-800 cursor-pointer"
            title={showCode ? "Show diagram" : "Show Mermaid source"}
          >
            {showCode ? <Eye className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
            <span>{showCode ? "Diagram" : "Code"}</span>
          </button>
        )}
        <CopyCodeButton text={chart} />
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
            className="flex flex-col items-center justify-center gap-2 p-6 min-h-[10rem] bg-[#0a0a0a]"
            role="status"
            aria-live="polite"
            aria-label={streaming ? "Waiting for diagram" : "Rendering diagram"}
          >
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            <span className="text-[11px] font-mono text-zinc-600">
              {streaming ? "waiting for diagram…" : "rendering…"}
            </span>
          </div>
        )
      ) : (
        <>
          {error && (
            <div
              className="flex items-start gap-1.5 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-400/90"
              title={error}
            >
              <AlertTriangle className="h-3 w-3 mt-px shrink-0" />
              <span className="font-sans break-words">{error.split("\n")[0]}</span>
            </div>
          )}
          <pre className="p-4 bg-[#0a0a0a] text-zinc-100 font-mono text-xs overflow-x-auto leading-5">
            <code>{chart}</code>
          </pre>
        </>
      )}
    </div>
  );
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex items-center px-1.5 py-0.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
    >
      {children}
    </button>
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}