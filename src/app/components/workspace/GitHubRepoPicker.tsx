"use client";

import { useState } from "react";
import { ArrowRight, Check, Globe, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GithubRepoOption } from "./types";

interface GitHubRepoPickerProps {
  repos: GithubRepoOption[];
  isLoading: boolean;
  selectedUrl?: string;
  onSelectRepo: (repo: GithubRepoOption) => void;
  onLoadMore: () => void;
  hasMore?: boolean;
  onUpgrade?: () => void;
}

export function GitHubRepoPicker({
  repos,
  isLoading,
  selectedUrl,
  onSelectRepo,
  onLoadMore,
  hasMore = true,
  onUpgrade,
}: GitHubRepoPickerProps) {
  const [filterText, setFilterText] = useState("");

  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredRepos = normalizedFilter
    ? repos.filter(
        (repo) =>
          repo.name.toLowerCase().includes(normalizedFilter) ||
          repo.owner.toLowerCase().includes(normalizedFilter) ||
          (repo.description ?? "").toLowerCase().includes(normalizedFilter),
      )
    : repos;

  return (
    <div className="space-y-3">
      {repos.length > 0 && (
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter repositories..."
          aria-label="Filter repositories"
          className="w-full rounded-control border border-line bg-input px-3.5 py-2 text-xs text-input-ink transition-[border-color] duration-150 placeholder:text-ink-4 hover:border-line-2 focus:border-accent focus:outline-none"
        />
      )}

      {isLoading && repos.length === 0 ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-ink-4" aria-hidden />
        </div>
      ) : repos.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-4">No repositories found on GitHub.</p>
      ) : filteredRepos.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-4">No matching repositories found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {filteredRepos.map((repo) => {
            const isSelected = selectedUrl === repo.url;

            return (
              <div
                key={repo.githubId}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => {
                  if (repo.requiresUpgrade) {
                    onUpgrade?.();
                    return;
                  }
                  onSelectRepo(repo);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (repo.requiresUpgrade) onUpgrade?.();
                  else onSelectRepo(repo);
                }}
                className={cn(
                  "group flex cursor-pointer items-center justify-between gap-2 rounded-control border p-3 transition-colors duration-150 active:scale-[0.99]",
                  repo.requiresUpgrade
                    ? "border-amber-500/40 bg-amber-500/10 hover:border-amber-500/60 hover:bg-amber-500/20"
                    : isSelected
                      ? "border-accent bg-accent-soft shadow-card"
                      : "border-line bg-surface hover:border-line-2 hover:bg-surface-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {repo.private ? (
                      <Lock
                        className={cn(
                          "size-3 shrink-0",
                          repo.requiresUpgrade
                            ? "text-amber-500"
                            : isSelected
                              ? "text-accent-ink"
                              : "text-ink-4",
                        )}
                        aria-hidden
                      />
                    ) : (
                      <Globe
                        className={cn(
                          "size-3 shrink-0",
                          isSelected ? "text-accent-ink" : "text-ink-4",
                        )}
                        aria-hidden
                      />
                    )}
                    <span
                      className={cn(
                        "truncate text-xs font-semibold",
                        isSelected ? "font-bold text-accent-ink" : "text-ink-2",
                      )}
                    >
                      {repo.owner}/{repo.name}
                    </span>
                    {repo.requiresUpgrade && (
                      <span className="shrink-0 rounded-chip border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-500">
                        Requires Full Access
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-0.5 truncate pl-4.5 text-[10px] text-ink-4">
                      {repo.description}
                    </p>
                  )}
                </div>
                {isSelected ? (
                  <Check className="size-4 shrink-0 text-accent-ink" aria-hidden />
                ) : (
                  <ArrowRight
                    className="size-4 shrink-0 text-ink-4 transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-accent-ink"
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {repos.length > 0 && hasMore && (
        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoading}
            className="cursor-pointer rounded-control px-3 py-1 text-xs font-semibold text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          >
            {isLoading ? "Loading..." : "Load More Repositories"}
          </button>
        </div>
      )}
    </div>
  );
}
