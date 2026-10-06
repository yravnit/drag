"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyCodeButton } from "./CopyCodeButton";
import { MermaidBlock } from "./MermaidBlock";
import { ThinkingBlock } from "./ThinkingBlock";
import { extractThinking } from "./thinking";
import type { Citation } from "./types";

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
  if (!content) return null;

  const { thinking, answer } = extractThinking(content);
  const citationList = citations ?? [];
  const hasAnswer = Boolean(answer && answer.trim().length > 0);

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
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks and inline code
          code({ className, children, ...props }) {
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
              const uniqueId = `chart-${Math.random().toString(36).slice(2, 9)}`;
              return <MermaidBlock chart={codeString} id={uniqueId} />;
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
          p({ children }) {
            return (
              <p className="whitespace-pre-wrap leading-relaxed">
                {withCitations(children, citationList, onCitationClick)}
              </p>
            );
          },

          // Headings
          h1({ children }) {
            return (
              <h1 className="text-lg font-bold text-white mt-4 mb-2">
                {withCitations(children, citationList, onCitationClick)}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-base font-bold text-white mt-3 mb-1.5">
                {withCitations(children, citationList, onCitationClick)}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-sm font-semibold text-zinc-100 mt-2 mb-1">
                {withCitations(children, citationList, onCitationClick)}
              </h3>
            );
          },

          // Lists
          ul({ children }) {
            return <ul className="list-disc list-inside space-y-1 my-2 pl-2">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside space-y-1 my-2 pl-2">{children}</ol>;
          },
          li({ children }) {
            return (
              <li className="leading-relaxed">
                {withCitations(children, citationList, onCitationClick)}
              </li>
            );
          },

          // Blockquotes
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-teal-500 pl-4 py-1 my-2 text-zinc-400 italic bg-zinc-900/30 rounded-r">
                {withCitations(children, citationList, onCitationClick)}
              </blockquote>
            );
          },

          // Tables
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 border border-zinc-800 rounded-lg">
                <table className="min-w-full divide-y divide-zinc-800 text-xs text-left">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-zinc-900/80 text-zinc-300 font-semibold">{children}</thead>;
          },
          tbody({ children }) {
            return <tbody className="divide-y divide-zinc-850 bg-zinc-950/40">{children}</tbody>;
          },
          tr({ children }) {
            return <tr>{children}</tr>;
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 text-zinc-300 font-semibold">
                {withCitations(children, citationList, onCitationClick)}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 text-zinc-300">
                {withCitations(children, citationList, onCitationClick)}
              </td>
            );
          },

          // Links
          a({ href, children }) {
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
        }}
      >
        {answer}
      </ReactMarkdown>
      )}
    </div>
  );
}
