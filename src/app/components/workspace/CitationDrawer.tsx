"use client";

import { memo, useState } from "react";
import { Copy, Check, ExternalLink, AlertCircle, Download, Loader2, BookOpen } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { highlightLine } from "@/lib/highlight";
import { cn } from "@/lib/cn";
import type { Citation, WorkspaceRepository } from "./types";

interface CitationDrawerProps {
  citation: Citation | null;
  repository: WorkspaceRepository | null;
  onClose: () => void;
  allCitations?: Citation[];
  onSelectCitation?: (citation: Citation) => void;
}

function CitationDrawerImpl({
  citation,
  repository,
  onClose,
  allCitations,
  onSelectCitation,
}: CitationDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (!citation) return null;

  const isPlaceholder = citation.filePath === "No sources cited yet" && citation.index === 0;
  const fileName = isPlaceholder
    ? "Sources"
    : citation.filePath.split("/").pop() || citation.filePath;

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
    <Drawer
      open
      onClose={onClose}
      title={fileName}
      badge={
        isPlaceholder ? null : (
          <span className="rounded-[6px] border border-chat-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-chat-ink-2">
            Lines {citation.startLine} - {citation.endLine}
          </span>
        )
      }
      footer={
        isPlaceholder ? null : (
          <div className="flex items-center gap-1">
            {githubUrl ? (
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-chat-ink-2 transition-colors duration-150 hover:bg-chat-3 hover:text-chat-ink"
                title="Open on GitHub"
              >
                <ExternalLink className="size-4" aria-hidden />
                <span>GitHub</span>
              </a>
            ) : (
              <span className="text-[10px] text-ink-4">Source unavailable</span>
            )}
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || (!citation.text && !repository)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-chat-ink-2 transition-colors duration-150 hover:bg-chat-3 hover:text-chat-ink disabled:pointer-events-none disabled:opacity-40"
              title="Download file"
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
              ) : downloaded ? (
                <Check className="size-4 text-ok" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!citation.text}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] text-chat-ink-2 transition-colors duration-150 hover:bg-chat-3 hover:text-chat-ink disabled:pointer-events-none disabled:opacity-40"
              title="Copy code"
            >
              {copied ? (
                <Check className="size-4 text-ok" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
            </button>
          </div>
        )
      }
    >
      <div className="p-3">
        {isPlaceholder ? (
          <div className="rounded-[8px] border border-dashed border-chat-line bg-surface-2 p-8 text-center">
            <BookOpen className="mx-auto mb-2.5 size-6 text-chat-ink-3" aria-hidden />
            <h3 className="text-sm font-semibold text-chat-ink">No sources cited yet</h3>
            <p className="mt-1 text-xs leading-relaxed text-chat-ink-2">
              When the assistant references code from your indexed repository, matching files and line ranges will appear here.
            </p>
          </div>
        ) : (
          <>
            {allCitations && allCitations.length > 1 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] font-semibold text-chat-ink-3">
                  Sources in this chat ({allCitations.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allCitations.map((c, idx) => {
                    const isActive =
                      c.filePath === citation.filePath &&
                      c.startLine === citation.startLine &&
                      c.endLine === citation.endLine;
                    const pillName = c.filePath.split("/").pop() || c.filePath;
                    return (
                      <button
                        key={`${c.filePath}-${c.startLine}-${idx}`}
                        type="button"
                        onClick={() => onSelectCitation?.(c)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors duration-150",
                          isActive
                            ? "bg-accent text-white"
                            : "border border-chat-line bg-surface-2 text-chat-ink-2 hover:bg-surface-3 hover:text-chat-ink",
                        )}
                      >
                        <span>{pillName}</span>
                        <span className="font-mono text-[9.5px] opacity-75">
                          :{c.startLine}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {downloadError && (
              <div className="mb-3 flex items-center gap-2 rounded-[6px] border border-danger-soft bg-danger-soft p-2.5 text-xs text-danger">
                <AlertCircle className="size-4 shrink-0" aria-hidden />
                <span>{downloadError}</span>
              </div>
            )}

            <div className="rounded-[6px] border border-chat-line bg-chat-2 p-3 shadow-card">
              <div className="truncate text-[12px] font-bold tracking-[-0.02em] text-chat-ink">
                {fileName}
              </div>
              <div className="mt-0.5 break-all font-mono text-[10px] text-chat-ink-3">
                {citation.filePath}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-chat-ink-2">
                <span>
                  Lines {citation.startLine} &ndash; {citation.endLine}
                </span>
                <span className="truncate rounded-[4px] border border-chat-line bg-surface-2 px-1.5 py-0.5 font-mono text-chat-ink-3">
                  {citation.symbolName ?? "module context"}
                </span>
                {repository && (
                  <span className="truncate font-mono text-chat-ink-3">
                    {repository.owner}/{repository.name}
                  </span>
                )}
              </div>

              {!citation.text || lines.length === 0 ? (
                <div className="mt-3 rounded-[6px] border border-dashed border-chat-line bg-surface-2 p-8 text-center">
                  <AlertCircle className="mx-auto mb-2 size-5 text-chat-ink-3" aria-hidden />
                  <p className="text-xs text-chat-ink-2">
                    Snippet content unavailable for this citation.
                  </p>
                </div>
              ) : (
                <div className="code-surface mt-2.5 overflow-x-auto rounded-[6px]">
                  <table className="w-full border-collapse">
                    <tbody>
                      {lines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-white/5">
                          <td
                            className="w-8 select-none border-r border-code-line py-px pl-2 pr-2 text-right font-mono text-[11px] leading-[1.7]"
                            style={{ color: "var(--code-comment)" }}
                          >
                            {citation.startLine + idx}
                          </td>
                          <td className="whitespace-pre px-2 font-mono text-[11px] leading-[1.7]">
                            <code>{highlightLine(line)}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const CitationDrawer = memo(CitationDrawerImpl);
