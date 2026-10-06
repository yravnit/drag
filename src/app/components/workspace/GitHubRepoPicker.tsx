"use client";

import { useState } from "react";
import { Loader2, ArrowRight, Lock, Globe, Check } from "lucide-react";
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

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(filterText.toLowerCase()) ||
      r.owner.toLowerCase().includes(filterText.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(filterText.toLowerCase())),
  );

  return (
    <div className="space-y-3">
      {repos.length > 0 && (
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter repositories..."
          className="w-full bg-zinc-950 border border-zinc-850 hover:border-zinc-800 focus:border-zinc-700 rounded-xl px-3.5 py-2 text-xs text-zinc-200 focus:outline-none transition"
        />
      )}

      {isLoading && repos.length === 0 ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : repos.length === 0 ? (
        <p className="text-center text-xs text-zinc-600 py-6">No repositories found on GitHub.</p>
      ) : filteredRepos.length === 0 ? (
        <p className="text-center text-xs text-zinc-600 py-6">No matching repositories found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
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
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (repo.requiresUpgrade) onUpgrade?.();
                  else onSelectRepo(repo);
                }}
                className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer group transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 ${
                  repo.requiresUpgrade
                    ? "border-amber-900/40 bg-amber-950/10 hover:border-amber-600/60 hover:bg-amber-950/25"
                    : isSelected
                      ? "border-teal-500 bg-teal-500/15 ring-1 ring-teal-500/40 shadow-sm"
                      : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-600 hover:bg-zinc-900"
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    {repo.private ? (
                      <Lock className={`h-3 w-3 shrink-0 ${repo.requiresUpgrade ? "text-amber-400" : isSelected ? "text-teal-400" : "text-zinc-500"}`} />
                    ) : (
                      <Globe className={`h-3 w-3 shrink-0 ${isSelected ? "text-teal-400" : "text-zinc-500"}`} />
                    )}
                    <span className={`text-xs font-semibold truncate ${isSelected ? "text-white font-bold" : "text-zinc-300 group-hover:text-white"}`}>
                      {repo.owner}/{repo.name}
                    </span>
                    {repo.requiresUpgrade && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                        Requires Full Access
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <div className="text-[10px] text-zinc-500 truncate mt-0.5 pl-4.5">
                      {repo.description}
                    </div>
                  )}
                </div>
                {isSelected ? (
                  <Check className="h-4 w-4 text-teal-400 shrink-0" />
                ) : (
                  <ArrowRight className="h-4 w-4 text-zinc-600 transition shrink-0 group-hover:text-teal-400 group-hover:translate-x-0.5" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {repos.length > 0 && hasMore && (
        <div className="pt-2 text-center">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="rounded-lg px-3 py-1 text-xs font-semibold text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? "Loading..." : "Load More Repositories"}
          </button>
        </div>
      )}
    </div>
  );
}
