import { Check } from "lucide-react";
import { TechWindow } from "../TechWindow";

type TokenKind = "keyword" | "string" | "func" | "punct";

interface CodePart {
  text: string;
  kind?: TokenKind;
}

interface CitedLine {
  number: number;
  parts: CodePart[];
}

const CITED_LINES: CitedLine[] = [
  {
    number: 12,
    parts: [
      { text: "  if " },
      { text: "!rawScope", kind: "punct" },
      { text: ") " },
      { text: "return", kind: "keyword" },
      { text: " [];" },
    ],
  },
  {
    number: 13,
    parts: [{ text: "  " }, { text: "return", kind: "keyword" }, { text: " rawScope" }],
  },
  {
    number: 14,
    parts: [
      { text: "    ." },
      { text: "split", kind: "func" },
      { text: "(" },
      { text: "/[,\\s]+/", kind: "string" },
      { text: ")" },
    ],
  },
  {
    number: 15,
    parts: [
      { text: "    ." },
      { text: "map", kind: "func" },
      { text: "((s) => s." },
      { text: "trim", kind: "func" },
      { text: "()." },
      { text: "toLowerCase", kind: "func" },
      { text: "())" },
    ],
  },
  {
    number: 16,
    parts: [{ text: "}" }],
  },
];

const SHA_CHIP = "rounded-[4px] bg-[rgba(174,129,255,0.15)] px-1.5 py-px text-[#ae81ff]";

export function VerifySyncVisual() {
  return (
    <TechWindow title="drag-verify — source inspection & incremental sync">
      <div className="flex flex-col gap-3 text-left font-mono text-xs leading-[1.6] text-code-fg">
        <div className="rounded-[8px] border border-[#3e3d32] border-l-[3px] border-l-[#a6e22e] bg-[#1e1f1c] px-3.5 py-3">
          <div className="mb-2 flex items-center justify-between border-b border-[#3e3d32] pb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#ae81ff]">[1]</span>
              <span className="font-semibold text-[#66d9ef]">src/lib/auth/accessMode.ts</span>
              <span className="text-[#75715e]">·</span>
              <span className="text-[#ae81ff]">L25–31</span>
            </div>
            <span className="text-[10.5px] text-[#a6e22e]">parseGitHubScopes()</span>
          </div>

          <div className="code-surface scroll-thin overflow-x-auto rounded-[5px] px-3 py-2 text-[11px] leading-[1.55]">
            {CITED_LINES.map((line) => (
              <div key={line.number}>
                <span className="tok-comment">{line.number}:</span>{" "}
                {line.parts.map((part, index) =>
                  part.kind ? (
                    <span key={index} className={`tok-${part.kind}`}>
                      {part.text}
                    </span>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[8px] border border-[#3e3d32] bg-[#1e1f1c] px-3.5 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="text-[#75715e]">Git HEAD:</span>
              <span className={SHA_CHIP}>a3f9c21</span>
              <span>→</span>
              <span className={SHA_CHIP}>b71e004</span>
            </div>
            <span className="font-semibold text-[#a6e22e]">+4 files changed</span>
          </div>

          <div className="flex items-center justify-between border-t border-[#3e3d32] pt-1.5 text-[10.5px] text-[#75715e]">
            <span className="flex items-center gap-1.5 text-[#a6e22e]">
              <Check size={12} aria-hidden className="text-[#a6e22e]" /> 4 files re-indexed · 1,847
              cached
            </span>
            <span className="italic">380ms sync</span>
          </div>
        </div>
      </div>
    </TechWindow>
  );
}
