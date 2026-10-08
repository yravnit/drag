import { Check, FolderGit } from "lucide-react";
import { TechWindow } from "../TechWindow";

const REPOSITORIES = [
  { name: "next.js", org: "vercel", private: false },
  { name: "internal-api", org: "acme-corp", private: true },
  { name: "design-system", org: "acme-corp", private: false },
];

export function ConnectVisual() {
  return (
    <TechWindow title="github.com/repositories">
      <div className="text-left font-mono text-xs leading-[1.65] text-code-fg">
        <div className="flex flex-col gap-2 rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-3.5 py-3">
          {REPOSITORIES.map((repo, index) => (
            <div
              key={repo.name}
              className={
                index === 0
                  ? "flex items-center justify-between rounded-[6px] border border-[rgba(166,226,46,0.3)] bg-[rgba(166,226,46,0.1)] px-2.5 py-1.5"
                  : "flex items-center justify-between rounded-[6px] border border-transparent px-2.5 py-1.5"
              }
            >
              <div className="flex items-center gap-2">
                <FolderGit
                  size={14}
                  aria-hidden
                  className={repo.private ? "text-[#fd971f]" : "text-[#66d9ef]"}
                />
                <span className="font-semibold text-code-fg">{repo.name}</span>
                <span className="text-[11px] text-[#75715e]">({repo.org})</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    repo.private
                      ? "rounded-[4px] bg-[rgba(253,151,31,0.15)] px-1.5 py-px text-[10px] text-[#fd971f]"
                      : "rounded-[4px] bg-[rgba(166,226,46,0.15)] px-1.5 py-px text-[10px] text-[#a6e22e]"
                  }
                >
                  {repo.private ? "private" : "public"}
                </span>
                <span className="text-[11px] font-semibold text-[#a6e22e]">Ready</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-[#a6e22e]">
          <span className="flex items-center gap-1.5">
            <Check size={13} aria-hidden className="text-[#a6e22e]" /> {REPOSITORIES.length}{" "}
            repositories discovered via OAuth
          </span>
          <span className="font-normal text-[#75715e]">repo, read:org scope</span>
        </div>
      </div>
    </TechWindow>
  );
}
