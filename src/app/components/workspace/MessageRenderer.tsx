"use client";

import React, { useId, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyCodeButton } from "./CopyCodeButton";
import { MermaidBlock } from "./MermaidBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { extractThinking } from "./thinking";
import type { Citation } from "./types";

// Hoisted so the plugin array identity is stable across renders.
const REMARK_PLUGINS = [remarkGfm];

/** Props react-markdown hands each component override, narrowed to the element being overridden. */
type MdProps<T extends keyof React.JSX.IntrinsicElements> =
  React.JSX.IntrinsicElements[T] & {
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
      className="px-1.5 py-0.5 mx-0.5 rounded text-xs font-mono bg-zinc-800 hover:bg-zinc-700 active:scale-90 text-teal-400 hover:text-teal-300 border border-zinc-700 transition cursor-pointer"
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
              className="px-1.5 py-0.5 rounded text-xs font-mono bg-zinc-850 text-teal-300 border border-zinc-750"
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
          <div className="relative group rounded-lg overflow-hidden border border-zinc-800 my-3">
            <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900 text-xs text-zinc-400 font-mono border-b border-zinc-800">
              <span>{language || "code"}</span>
              <CopyCodeButton text={codeString} />
            </div>
            <pre className="p-4 bg-[#0a0a0a] text-zinc-100 font-mono text-xs overflow-x-auto leading-5">
              <code>{codeString}</code>
            </pre>
          </div>
        );
      },

      // Paragraphs with inline citation detection
      p({ children }: MdProps<"p">) {
        return (
          <p className="whitespace-pre-wrap leading-relaxed">
            {withCitations(children, citationList, onCitationClick)}
          </p>
        );
      },

      // Headings
      h1({ children }: MdProps<"h1">) {
        return (
          <h1 className="text-lg font-bold text-white mt-4 mb-2">
            {withCitations(children, citationList, onCitationClick)}
          </h1>
        );
      },
      h2({ children }: MdProps<"h2">) {
        return (
          <h2 className="text-base font-bold text-white mt-3 mb-1.5">
            {withCitations(children, citationList, onCitationClick)}
          </h2>
        );
      },
      h3({ children }: MdProps<"h3">) {
        return (
          <h3 className="text-sm font-semibold text-zinc-100 mt-2 mb-1">
            {withCitations(children, citationList, onCitationClick)}
          </h3>
        );
      },

      // Lists
      ul({ children }: MdProps<"ul">) {
        return <ul className="list-disc list-inside space-y-1 my-2 pl-2">{children}</ul>;
      },
      ol({ children }: MdProps<"ol">) {
        return <ol className="list-decimal list-inside space-y-1 my-2 pl-2">{children}</ol>;
      },
      li({ children }: MdProps<"li">) {
        return (
          <li className="leading-relaxed">
            {withCitations(children, citationList, onCitationClick)}
          </li>
        );
      },

      // Blockquotes
      blockquote({ children }: MdProps<"blockquote">) {
        return (
          <blockquote className="border-l-2 border-teal-500 pl-4 py-1 my-2 text-zinc-400 italic bg-zinc-900/30 rounded-r">
            {withCitations(children, citationList, onCitationClick)}
          </blockquote>
        );
      },

      // Tables
      table({ children }: MdProps<"table">) {
        return (
          <div className="overflow-x-auto my-3 border border-zinc-800 rounded-lg">
            <table className="min-w-full divide-y divide-zinc-800 text-xs text-left">
              {children}
            </table>
          </div>
        );
      },
      thead({ children }: MdProps<"thead">) {
        return <thead className="bg-zinc-900/80 text-zinc-300 font-semibold">{children}</thead>;
      },
      tbody({ children }: MdProps<"tbody">) {
        return <tbody className="divide-y divide-zinc-850 bg-zinc-950/40">{children}</tbody>;
      },
      tr({ children }: MdProps<"tr">) {
        return <tr>{children}</tr>;
      },
      th({ children }: MdProps<"th">) {
        return (
          <th className="px-3 py-2 text-zinc-300 font-semibold">
            {withCitations(children, citationList, onCitationClick)}
          </th>
        );
      },
      td({ children }: MdProps<"td">) {
        return (
          <td className="px-3 py-2 text-zinc-300">
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
            className="text-teal-400 hover:text-teal-300 underline underline-offset-2"
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
    <div className="space-y-3 text-sm leading-relaxed text-zinc-200 break-words">
      {thinking && (
        <ThinkingBlock
          thinking={thinking}
          isStreaming={isStreaming}
          hasAnswer={hasAnswer}
        />
      )}
      {hasAnswer && (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
          {answer}
        </ReactMarkdown>
      )}
    </div>
  );
}
