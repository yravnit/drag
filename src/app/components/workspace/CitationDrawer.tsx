"use client";

import React, { useState, useEffect } from "react";
import { FileCode, X, Copy, Check, ExternalLink, AlertCircle, Download, Loader2 } from "lucide-react";
import type { Citation, WorkspaceRepository } from "./types";

interface CitationDrawerProps {
  citation: Citation | null;
  repository: WorkspaceRepository | null;
  onClose: () => void;
}

/**
 * Lightweight syntax highlighter for code preview lines.
 * Highlights keywords, strings, comments, and identifiers cleanly.
 */
function highlightCodeLine(line: string): React.ReactNode {
  // Comment line
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return <span className="text-zinc-500 italic">{line}</span>;
  }

  // Tokenize line by keywords and strings
  const tokens = line.split(
    /(\b(?:import|export|function|const|let|var|return|async|await|if|else|class|interface|type|from|default|extends|implements|new|try|catch|finally|throw)\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\/\/.+$)/g,
  );

  return (
    <>
      {tokens.map((token, idx) => {
        if (!token) return null;
        if (
          /^(?:import|export|function|const|let|var|return|async|await|if|else|class|interface|type|from|default|extends|implements|new|try|catch|finally|throw)$/.test(
            token,
          )
        ) {
          return (
            <span key={idx} className="text-teal-400 font-semibold">
              {token}
            </span>
          );
        }
        if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
          return (
            <span key={idx} className="text-emerald-300">
              {token}
            </span>
          );
        }
        if (token.startsWith("//")) {
          return (
            <span key={idx} className="text-zinc-500 italic">
              {token}
            </span>
          );
        }
        return <span key={idx}>{token}</span>;
      })}
    </>
  );
}

export function CitationDrawer({ citation, repository, onClose }: CitationDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Esc key listener to close drawer
  useEffect(() => {
    if (!citation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [citation, onClose]);

  if (!citation) return null;

  const fileName = citation.filePath.split("/").pop() || citation.filePath;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(citation.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy citation text:", err);
    }
  };

  const triggerBlobDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);

    try {
      if (repository?.id) {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(repository.id)}/file?path=${encodeURIComponent(citation.filePath)}`,
        );

        if (res.ok) {
          const blob = await res.blob();
          triggerBlobDownload(blob, fileName);
          return;
        }

        if (res.status === 403) {
          setDownloadError("You do not have permission to download this file.");
          return;
        }
      }

      // Fallback: If full file cannot be fetched from backend, download cited snippet
      if (citation.text) {
        const blob = new Blob([citation.text], { type: "text/plain;charset=utf-8" });
        triggerBlobDownload(blob, fileName);
      } else {
        setDownloadError("File content unavailable for download.");
      }
    } catch (err) {
      console.error("Failed to download citation file:", err);
      // Fallback download of text
      if (citation.text) {
        const blob = new Blob([citation.text], { type: "text/plain;charset=utf-8" });
        triggerBlobDownload(blob, fileName);
      } else {
        setDownloadError("Failed to download file.");
      }
    } finally {
      setDownloading(false);
    }
  };

  // Build GitHub link safely when repository metadata is available
  let githubUrl: string | null = null;
  if (repository?.owner && repository?.name && citation.filePath) {
    const branch = encodeURIComponent(repository.defaultBranch || "main");
    const cleanPath = citation.filePath.split("/").map(encodeURIComponent).join("/");
    githubUrl = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/blob/${branch}/${cleanPath}#L${citation.startLine}-L${citation.endLine}`;
  }

  const lines = citation.text ? citation.text.split("\n") : [];

  return (
    <>
      {/* Backdrop for click-outside dismissal */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-[#0d0d10] border-l border-zinc-850 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-teal-400 shrink-0">
              <FileCode className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-white truncate max-w-[280px]">
                {fileName}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-zinc-400 font-mono">
                  Lines {citation.startLine} - {citation.endLine}
                </span>
                {citation.symbolName ? (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-850 border border-zinc-750 text-teal-300 font-mono truncate max-w-[150px]">
                    {citation.symbolName}
                  </span>
                ) : (
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-500 font-mono">
                    module context
                  </span>
                )}
                {repository && (
                  <span className="text-[9px] text-zinc-500 font-mono truncate max-w-[120px]">
                    {repository.owner}/{repository.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {githubUrl ? (
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 hover:bg-zinc-900 active:scale-90 rounded-lg text-zinc-400 hover:text-white transition flex items-center gap-1 text-xs"
                title="Open on GitHub"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <span className="text-[10px] text-zinc-600 px-1">Source unavailable</span>
            )}
            <button
              onClick={handleDownload}
              disabled={downloading || (!citation.text && !repository)}
              className="p-1.5 hover:bg-zinc-900 active:scale-90 rounded-lg text-zinc-400 hover:text-white transition disabled:opacity-40 cursor-pointer"
              title="Download file"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
              ) : downloaded ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={handleCopy}
              disabled={!citation.text}
              className="p-1.5 hover:bg-zinc-900 active:scale-90 rounded-lg text-zinc-400 hover:text-white transition disabled:opacity-40 cursor-pointer"
              title="Copy code"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-zinc-900 active:scale-90 rounded-lg text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
              title="Close drawer (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Code Body */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-[#060608] leading-5">
          {downloadError && (
            <div className="mb-3 p-2.5 bg-red-950/20 border border-red-900/30 rounded-lg text-xs text-red-400 flex items-center gap-2 font-sans">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{downloadError}</span>
            </div>
          )}

          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-900 text-zinc-500">
            <span className="text-[10px] uppercase font-bold tracking-wider">Source View</span>
            <span className="text-[10px] font-semibold text-zinc-400 truncate max-w-[320px]">
              {citation.filePath}
            </span>
          </div>

          {!citation.text || lines.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-zinc-850 rounded-xl bg-zinc-950/30">
              <AlertCircle className="h-5 w-5 text-zinc-500 mx-auto mb-2" />
              <p className="text-xs text-zinc-400 font-sans">
                Snippet content unavailable for this citation.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-850 bg-[#0a0a0c] overflow-hidden">
              <pre className="p-3 text-zinc-200 overflow-x-auto select-text font-mono text-xs">
                <table className="border-collapse w-full">
                  <tbody>
                    {lines.map((line, idx) => {
                      const lineNumber = citation.startLine + idx;
                      return (
                        <tr key={idx} className="hover:bg-zinc-900/50">
                          <td className="pr-3 pl-1 text-right select-none text-zinc-600 font-mono text-[11px] w-8">
                            {lineNumber}
                          </td>
                          <td className="pl-3 border-l border-zinc-850 whitespace-pre">
                            <code>{highlightCodeLine(line)}</code>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
