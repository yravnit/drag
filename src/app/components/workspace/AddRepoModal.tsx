"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertTriangle, Globe, GitBranch } from "lucide-react";
import { GitHubRepoPicker } from "./GitHubRepoPicker";
import { formatLimit } from "./formatters";
import type { GithubRepoOption, PlanUsageData } from "./types";

interface AddRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddRepo: (url: string, branch?: string) => Promise<void>;
  githubRepos: GithubRepoOption[];
  githubLoading: boolean;
  onLoadMoreGithub: () => void;
  repoAddLoading: boolean;
  repoAddError: string;
  accessMode?: "public" | "full";
  onUpgradeAccess?: () => void;
  entitlements?: PlanUsageData["entitlements"] | null;
}

export function AddRepoModal({
  isOpen,
  onClose,
  onAddRepo,
  githubRepos,
  githubLoading,
  onLoadMoreGithub,
  repoAddLoading,
  repoAddError,
  accessMode,
  onUpgradeAccess,
  entitlements,
}: AddRepoModalProps) {
  const [selectedUrl, setSelectedUrl] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const lastBranchFetch = useRef("");

  const isBranchAllowed = entitlements?.plan !== "free";

  const handleClose = () => {
    setSelectedUrl("");
    setManualUrl("");
    setBranch("main");
    setBranches([]);
    lastBranchFetch.current = "";
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !repoAddLoading) handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!isOpen) return null;

  const fetchBranches = async (owner: string, repoName: string, fallbackDefault?: string) => {
    // Guard against a GitHub API call per keystroke while the URL is typed.
    const key = `${owner}/${repoName}`;
    if (lastBranchFetch.current === key) return;
    lastBranchFetch.current = key;

    setBranchesLoading(true);
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repoName)}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.branches) && data.branches.length > 0) {
          setBranches(data.branches);
          if (fallbackDefault && data.branches.includes(fallbackDefault)) {
            setBranch(fallbackDefault);
          } else if (data.branches[0]) {
            setBranch(data.branches[0]);
          }
          return;
        }
      }
    } catch (err) {
      console.error("Failed to fetch branches:", err);
    } finally {
      setBranchesLoading(false);
    }
  };

  const handleSelectGithubRepo = (repo: GithubRepoOption) => {
    setSelectedUrl(repo.url);
    setManualUrl(repo.url);
    const defaultBranch = repo.defaultBranch || "main";
    setBranch(defaultBranch);
    fetchBranches(repo.owner, repo.name, defaultBranch);
  };

  const handleUrlChange = (value: string) => {
    setManualUrl(value);
    setSelectedUrl(value);
    const match = value.trim().match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (match) {
      const owner = match[1];
      const repoName = match[2].replace(/\.git$/, "");
      fetchBranches(owner, repoName, branch);
    }
  };

  const handleSubmit = async () => {
    if (!manualUrl.trim() || repoAddLoading) return;
    const branchToSend = isBranchAllowed && branch.trim() ? branch.trim() : undefined;
    await onAddRepo(manualUrl.trim(), branchToSend);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-100"
      onClick={repoAddLoading ? undefined : handleClose}
    >
      <div
        className="relative w-full max-w-2xl bg-[#0f0f12] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40 shrink-0">
          <div>
            <h3 className="text-md font-bold text-white">Add Repository</h3>
            <p className="text-xs text-zinc-500">Pick from GitHub or enter repository URL manually.</p>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-zinc-900 active:scale-90 rounded-lg text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
            title="Close modal (Esc)"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Access mode banner */}
          {accessMode === "public" && (
            <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-teal-900/40 bg-teal-950/20 text-xs text-teal-200">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-teal-400 shrink-0" />
                <span>Public-only mode active. You can index any public GitHub repository.</span>
              </div>
              {onUpgradeAccess && (
                <button
                  type="button"
                  onClick={onUpgradeAccess}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 transition cursor-pointer shrink-0"
                >
                  Upgrade to Full Access
                </button>
              )}
            </div>
          )}

          {/* Repository Policy Limits (hidden for boss plan) */}
          {entitlements && entitlements.plan !== "boss" && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                <span>Repository Policy ({entitlements.plan} plan)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-zinc-300">
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400 shrink-0" />
                  <span>
                    {entitlements.repositorySizeLimitBytes >= 1e14
                      ? "∞"
                      : `${Math.round(entitlements.repositorySizeLimitBytes / (1024 * 1024))} MB maximum`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400 shrink-0" />
                  <span>{formatLimit(entitlements.fileLimit)} files maximum</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400 shrink-0" />
                  <span>
                    {entitlements.allowedBranch === "*"
                      ? "any branch allowed"
                      : entitlements.plan === "enterprise" && entitlements.allowedBranch !== "main"
                        ? `${entitlements.allowedBranch} branch entitlement`
                        : `${entitlements.allowedBranch} branch only`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400 shrink-0" />
                  <span>
                    {entitlements.incrementalReindexAllowed
                      ? "incremental reindexing enabled"
                      : "incremental reindexing unavailable"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Section 1: GitHub Repositories found */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Repositories found
              </label>
              {githubRepos.length > 0 && (
                <span className="text-[10px] text-zinc-500">
                  Click a repository to select it
                </span>
              )}
            </div>

            <GitHubRepoPicker
              repos={githubRepos}
              isLoading={githubLoading}
              selectedUrl={selectedUrl}
              onSelectRepo={handleSelectGithubRepo}
              onLoadMore={onLoadMoreGithub}
              onUpgrade={onUpgradeAccess}
              hasMore={githubRepos.length % 15 === 0}
            />
          </div>

          <div className="relative flex items-center justify-center py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-900" />
            </div>
            <span className="relative z-10 px-3 bg-[#0f0f12] text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
              Or specify repository manually
            </span>
          </div>

          {/* Section 2: Repository URL */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              GitHub Repository URL
            </label>
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="https://github.com/owner/repo"
              disabled={repoAddLoading}
              className="w-full bg-zinc-950 border border-zinc-850 hover:border-zinc-800 focus:border-zinc-700 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none transition disabled:opacity-50"
            />
          </div>

          {/* Section 3: Branch Input (allowed for hobby, enterprise, boss; disabled for free) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="repo-branch-input"
                className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"
              >
                <GitBranch className="h-3 w-3 text-zinc-400" />
                <span>Branch</span>
              </label>
              <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1.5">
                {branchesLoading && <span className="text-teal-400 animate-pulse">fetching branches...</span>}
                {!isBranchAllowed && <span className="text-zinc-600">main branch only on Free plan</span>}
                {isBranchAllowed && entitlements?.allowedBranch === "*" && <span>Any branch</span>}
              </div>
            </div>

            <div className="relative">
              <input
                id="repo-branch-input"
                type="text"
                list="branch-options"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                disabled={!isBranchAllowed || repoAddLoading}
                className={`w-full bg-zinc-950 border border-zinc-850 rounded-xl px-4 py-2.5 text-xs font-mono transition focus:outline-none ${
                  !isBranchAllowed
                    ? "opacity-60 cursor-not-allowed text-zinc-500"
                    : "text-zinc-200 hover:border-zinc-800 focus:border-zinc-700"
                }`}
              />

              {branches.length > 0 && (
                <datalist id="branch-options">
                  {branches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              )}
            </div>

            {isBranchAllowed && branches.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-zinc-600">Quick select:</span>
                {branches.slice(0, 6).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBranch(b)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer active:scale-95 ${
                      branch === b
                        ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                        : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </div>

          {repoAddError && (
            <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-400 whitespace-pre-line leading-relaxed">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Limit check</span>
              </div>
              <div className="mt-1 pl-6">{repoAddError}</div>
            </div>
          )}
        </div>

        {/* Modal Footer with Single Add Button */}
        <div className="px-6 py-4 border-t border-zinc-900 bg-zinc-950/60 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-zinc-500 min-w-0 pr-3">
            {manualUrl ? (
              <span className="truncate max-w-[280px] sm:max-w-md block font-mono text-zinc-400">
                {manualUrl} {branch ? `(${branch})` : ""}
              </span>
            ) : (
              <span>Select a repository or enter URL to begin</span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              disabled={repoAddLoading}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-900 active:scale-95 transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!manualUrl.trim() || repoAddLoading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 font-bold text-zinc-950 text-xs transition active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 cursor-pointer shadow-lg shadow-teal-500/10"
            >
              {repoAddLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Starting ingestion...</span>
                </>
              ) : (
                <span>Add Repository</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
