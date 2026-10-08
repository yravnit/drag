"use client";

import React, { useId, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyCodeButton } from "./CopyCodeButton";
import { MermaidBlock } from "./MermaidBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { extractThinking } from "./thinking";
import { highlightCode } from "@/lib/highlight";
import type { Citation } from "./types";

// Hoisted so the plugin array identity is stable across renders.
const REMARK_PLUGINS = [remarkGfm];

/** Props react-markdown hands each component override, narrowed to the element being overridden. */
type MdProps<T extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[T] & {
  children?: React.ReactNode;
  className?: string;
  href?: string;
};

/**
 * Deterministic DOM id for a diagram: a hash of its own source, scoped to the message.
 * Keyed on content rather than a render counter, so re-rendering an unchanged message keeps the
 * same id and `MermaidBlock` does not clear and re-render a finished diagram.
 * ponytail: djb2 over the chart text; collisions only ever merge two identical diagrams, which is
 * the same rendering. Upgrade path: pass the hast node position if per-occurrence identity matters.
 */
function chartDomId(messageId: string, chart: string): string {
  let hash = 5381;
  for (let i = 0; i < chart.length; i++) {
    hash = ((hash << 5) + hash + chart.charCodeAt(i)) | 0;
  }
  return `chart-${messageId}-${(hash >>> 0).toString(36)}`;
}

interface MessageRendererProps {
  content: string;
  citations?: Citation[] | null;
  onCitationClick: (citation: Citation) => void;
  isStreaming?: boolean;
}

function citationButton(
  cit: Citation,
  label: string,
  key: string,
  onCitationClick: (citation: Citation) => void,
) {
  return (
    <button
      key={key}
      type="button"
      onClick={() => onCitationClick(cit)}
      className="mx-0.5 cursor-pointer rounded-[4px] border border-accent-soft bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] font-semibold text-accent-ink transition-colors duration-150 hover:border-accent active:scale-90"
      title={`View citation [${cit.index}]: ${cit.filePath}`}
    >
      {label}
    </button>
  );
}

/**
 * Replaces every [n] marker inside a text node with a clickable citation button.
 */
function renderTextWithCitations(
  text: string,
  citations: Citation[],
  onCitationClick: (citation: Citation) => void,
): React.ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length <= 1) return text;

  return parts.map((part, idx) => {
    const citMatch = part.match(/^\[(\d+)\]$/);
    if (citMatch) {
      const index = parseInt(citMatch[1], 10);
      const cit = citations.find((c) => c.index === index);
      if (cit) return citationButton(cit, part, `cit-${idx}`, onCitationClick);
    }
    return part;
  });
}

/**
 * Applies citation markers to a markdown node's children, descending into nested
 * inline elements. Without this, a [1] written inside a list item, table cell, or
 * heading rendered as plain text and was not clickable.
 */
function withCitations(
  children: React.ReactNode,
  citations: Citation[],
  onCitationClick: (citation: Citation) => void,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      return renderTextWithCitations(child, citations, onCitationClick);
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      const nested = child.props.children;
      if (nested === undefined || nested === null) return child;
      return React.cloneElement(child, {
        children: withCitations(nested, citations, onCitationClick),
      });
    }
    return child;
  });
}

/**
 * Production markdown rendering pipeline supporting GitHub Flavored Markdown,
 * syntax highlighted code blocks with copy button, Mermaid diagrams, and inline citations.
 */
export function MessageRenderer({
  content,
  citations,
  onCitationClick,
  isStreaming = false,
}: MessageRendererProps) {
  // Stable across re-renders of the same message. A random id per render handed MermaidBlock a new
  // dependency on every streamed token and page-state update, so it cleared and re-rendered
  // finished diagrams, flickering them and repeating the work.
  const messageId = useId();

  const { thinking, answer } = extractThinking(content);
  const citationList = useMemo(() => citations ?? [], [citations]);
  const hasAnswer = Boolean(answer && answer.trim().length > 0);

  // Rebuilt only when the citations or the click handler change. Recreating it on every render
  // handed react-markdown a new component type each time, remounting the whole subtree.
  const components = useMemo(
    () => ({
      // Code blocks and inline code
      code({ className, children, ...props }: MdProps<"code">) {
        const match = /language-(\w+)/.exec(className || "");
        const language = match ? match[1] : "";
        const isInline = !match && !String(children).includes("\n");
        const codeString = String(children).replace(/\n$/, "");

        if (isInline) {
          return (
            <code
              className="rounded-[4px] border border-chat-line bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-accent-ink"
              {...props}
            >
              {children}
            </code>
          );
        }

        if (language === "mermaid") {
          // Derived from the diagram's own source, so it is stable across re-renders and still
          // distinct per diagram and per message.
          return (
            <MermaidBlock
              chart={codeString}
              id={chartDomId(messageId, codeString)}
              streaming={isStreaming}
            />
          );
        }

        return (
          <div className="my-3.5 overflow-hidden rounded-[10px]">
            <div className="flex items-center justify-between gap-2 border border-b-0 border-chat-line rounded-t-[10px] bg-surface-2 px-3.5 py-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wide text-chat-ink-3">
                {language || "code"}
              </span>
              <CopyCodeButton text={codeString} />
            </div>
            <pre className="m-0 overflow-x-auto">
              <code className="code-surface block rounded-b-[10px] px-4 py-3.5 text-[13px] leading-[1.7]">
                {highlightCode(codeString).map((nodes, index) => (
                  <span key={index} className="block">
                    {nodes}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        );
      },

      // A fenced block always renders its own surface above, so the wrapper only unwraps.
      pre({ children }: MdProps<"pre">) {
        return <>{children}</>;
      },

      // Paragraphs with inline citation detection
      p({ children }: MdProps<"p">) {
        return (
          <p className="whitespace-pre-wrap leading-[1.75]">
            {withCitations(children, citationList, onCitationClick)}
          </p>
        );
      },

      // Headings. Nohemi is display-only: it stays above 24px and smaller headings use Manrope.
      h1({ children }: MdProps<"h1">) {
        return (
          <h1 className="mt-5 mb-2 font-display text-[24px] font-semibold tracking-display text-chat-ink">
            {withCitations(children, citationList, onCitationClick)}
          </h1>
        );
      },
      h2({ children }: MdProps<"h2">) {
        return (
          <h2 className="mt-4 mb-1.5 font-sans text-[18px] font-semibold tracking-[-0.03em] text-chat-ink">
            {withCitations(children, citationList, onCitationClick)}
          </h2>
        );
      },
      h3({ children }: MdProps<"h3">) {
        return (
          <h3 className="mt-3 mb-1 font-sans text-[15px] font-semibold tracking-[-0.02em] text-chat-ink">
            {withCitations(children, citationList, onCitationClick)}
          </h3>
        );
      },

      // Lists
      ul({ children }: MdProps<"ul">) {
        return (
          <ul className="my-2 list-disc space-y-1 pl-5 text-chat-ink-2 marker:text-chat-ink-3">
            {children}
          </ul>
        );
      },
      ol({ children }: MdProps<"ol">) {
        return (
          <ol className="my-2 list-decimal space-y-1 pl-5 text-chat-ink-2 marker:text-chat-ink-3">
            {children}
          </ol>
        );
      },
      li({ children }: MdProps<"li">) {
        return (
          <li className="leading-[1.7]">
            {withCitations(children, citationList, onCitationClick)}
          </li>
        );
      },

      // Blockquotes
      blockquote({ children }: MdProps<"blockquote">) {
        return (
          <blockquote className="my-3 rounded-r-[6px] border-l-2 border-accent bg-surface-2 py-1 pl-3.5 pr-2 italic text-chat-ink-2">
            {withCitations(children, citationList, onCitationClick)}
          </blockquote>
        );
      },

      // Tables
      table({ children }: MdProps<"table">) {
        return (
          <div className="my-3 overflow-x-auto rounded-card border border-chat-line">
            <table className="min-w-full text-left text-[13px]">{children}</table>
          </div>
        );
      },
      thead({ children }: MdProps<"thead">) {
        return <thead className="bg-surface-2 font-semibold text-chat-ink">{children}</thead>;
      },
      tbody({ children }: MdProps<"tbody">) {
        return <tbody className="divide-y divide-chat-line-2">{children}</tbody>;
      },
      tr({ children }: MdProps<"tr">) {
        return <tr>{children}</tr>;
      },
      th({ children }: MdProps<"th">) {
        return (
          <th className="px-3 py-2 font-semibold text-chat-ink">
            {withCitations(children, citationList, onCitationClick)}
          </th>
        );
      },
      td({ children }: MdProps<"td">) {
        return (
          <td className="px-3 py-2 text-chat-ink-2">
            {withCitations(children, citationList, onCitationClick)}
          </td>
        );
      },

      // Links
      a({ href, children }: MdProps<"a">) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-ink underline underline-offset-2 hover:text-accent"
          >
            {children}
          </a>
        );
      },
    }),
    // isStreaming is in the deps because `code` closes over it. It only flips true at the start of
    // a turn and false at its end, so the worst case is one extra subtree remount per message.
    [citationList, onCitationClick, messageId, isStreaming],
  );

  if (!content) return null;

  return (
    <div className="break-words space-y-3 font-sans text-[14.5px] leading-[1.75] tracking-[-0.02em] text-chat-ink">
      {thinking && (
        <ThinkingBlock thinking={thinking} isStreaming={isStreaming} hasAnswer={hasAnswer} />
      )}
      {hasAnswer && (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
          {answer}
        </ReactMarkdown>
      )}
    </div>
  );
}
