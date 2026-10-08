"use client";

import { memo, useCallback, useRef, useState } from "react";
import { AlertTriangle, GitBranch, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
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

function AddRepoModalImpl({
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

  const handleClose = useCallback(() => {
    setSelectedUrl("");
    setManualUrl("");
    setBranch("main");
    setBranches([]);
    lastBranchFetch.current = "";
    onClose();
  }, [onClose]);

  const dismiss = useCallback(() => {
    if (!repoAddLoading) handleClose();
  }, [handleClose, repoAddLoading]);

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
    void fetchBranches(repo.owner, repo.name, defaultBranch);
  };

  const handleUrlChange = (value: string) => {
    setManualUrl(value);
    setSelectedUrl(value);
    const match = value.trim().match(/github\.com\/([^/]+)\/([^/]+)/i);
    if (match) {
      void fetchBranches(match[1], match[2].replace(/\.git$/, ""), branch);
    }
  };

  const handleSubmit = async () => {
    if (!manualUrl.trim() || repoAddLoading) return;
    const branchToSend = isBranchAllowed && branch.trim() ? branch.trim() : undefined;
    await onAddRepo(manualUrl.trim(), branchToSend);
  };

  const sizeLimitLabel =
    entitlements && entitlements.repositorySizeLimitBytes >= 1e14
      ? "∞"
      : entitlements
        ? `${Math.round(entitlements.repositorySizeLimitBytes / (1024 * 1024))} MB maximum`
        : null;

  const branchPolicyLabel = entitlements
    ? entitlements.allowedBranch === "*"
      ? "any branch allowed"
      : entitlements.plan === "enterprise" && entitlements.allowedBranch !== "main"
        ? `${entitlements.allowedBranch} branch entitlement`
        : `${entitlements.allowedBranch} branch only`
    : null;

  return (
    <Modal
      open={isOpen}
      onClose={dismiss}
      title="Add Repository"
      description="Pick from GitHub or enter repository URL manually."
      className="max-w-4xl h-[82vh] max-h-[780px] min-h-[580px]"
      footer={
        <>
          <span className="mr-auto min-w-0 truncate pr-3 text-[11px] text-ink-4">
            {manualUrl ? (
              <span className="block max-w-md truncate font-mono text-ink-3">
                {manualUrl} {branch ? `(${branch})` : ""}
              </span>
            ) : (
              "Select a repository or enter URL to begin"
            )}
          </span>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={repoAddLoading}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!manualUrl.trim() || repoAddLoading}
          >
            {repoAddLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                <span>Starting ingestion...</span>
              </>
            ) : (
              "Add Repository"
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {accessMode === "public" && (
          <div className="flex items-center justify-between gap-3 rounded-card border border-accent/40 bg-accent-soft p-3.5 text-xs text-accent-ink">
            <div className="flex min-w-0 items-center gap-2">
              <Globe className="size-4 shrink-0" aria-hidden />
              <span>Public-only mode active. You can index any public GitHub repository.</span>
            </div>
            {onUpgradeAccess && (
              <Button
                size="sm"
                variant="outline"
                onClick={onUpgradeAccess}
                className="shrink-0"
              >
                Upgrade to Full Access
              </Button>
            )}
          </div>
        )}

        {entitlements && entitlements.plan !== "boss" && (
          <div className="space-y-2 rounded-card border border-line bg-surface-2 p-3.5 text-xs">
            <h4 className="text-[10px] font-bold tracking-wider text-ink-4 uppercase">
              Repository Policy ({entitlements.plan} plan)
            </h4>
            <div className="grid grid-cols-1 gap-2 font-mono text-[11px] text-ink-2 sm:grid-cols-2">
              {sizeLimitLabel && (
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  {sizeLimitLabel}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {formatLimit(entitlements.fileLimit)} files maximum
              </span>
              {branchPolicyLabel && (
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  {branchPolicyLabel}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {entitlements.incrementalReindexAllowed
                  ? "incremental reindexing enabled"
                  : "incremental reindexing unavailable"}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[10px] font-bold tracking-wider text-ink-4 uppercase">
              Repositories found
            </h4>
            {githubRepos.length > 0 && (
              <span className="text-[11px] text-ink-4">Click a repository to select it</span>
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
            <div className="w-full border-t border-line" />
          </div>
          <span className="relative z-10 bg-page-2 px-3 text-[10px] font-bold tracking-wider text-ink-4 uppercase">
            Or specify repository manually
          </span>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="repo-url-input"
            className="text-[10px] font-bold tracking-wider text-ink-4 uppercase"
          >
            GitHub Repository URL
          </label>
          <input
            id="repo-url-input"
            type="text"
            value={manualUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
            placeholder="https://github.com/owner/repo"
            disabled={repoAddLoading}
            className="w-full rounded-control border border-line bg-input px-3.5 py-2.5 font-mono text-xs text-input-ink transition-[border-color] duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent focus:outline-none disabled:opacity-50"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="repo-branch-input"
              className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-ink-4 uppercase"
            >
              <GitBranch className="size-3 shrink-0" aria-hidden />
              <span>Branch</span>
            </label>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-4">
              {branchesLoading && (
                <span className="animate-pulse text-accent-ink">fetching branches...</span>
              )}
              {!isBranchAllowed && <span>main branch only on Free plan</span>}
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
              className={`w-full rounded-control border border-line bg-input px-3.5 py-2.5 font-mono text-xs transition-[border-color] duration-150 focus:outline-none ${
                isBranchAllowed
                  ? "text-input-ink hover:border-line-2 focus:border-accent"
                  : "cursor-not-allowed text-ink-4 opacity-60"
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
              <span className="text-[10px] text-ink-4">Quick select:</span>
              {branches.slice(0, 6).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBranch(b)}
                  className={`cursor-pointer rounded-chip border px-2 py-0.5 font-mono text-[10px] transition-colors duration-150 active:scale-95 ${
                    branch === b
                      ? "border-accent/40 bg-accent-soft text-accent-ink"
                      : "border-line bg-surface text-ink-3 hover:bg-surface-3 hover:text-ink"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          )}
        </div>

        {repoAddError && (
          <div className="rounded-card border border-danger-soft bg-danger-soft p-3 text-xs whitespace-pre-line leading-relaxed text-danger">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span>Limit check</span>
            </div>
            <div className="mt-1 pl-6">{repoAddError}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const AddRepoModal = memo(AddRepoModalImpl);
