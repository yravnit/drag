import { Cpu, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { PAGE_CONTAINER } from "./constants";

const TRUST_CARDS = [
  {
    icon: Cpu,
    tone: "text-ink",
    title: "What's Stored",
    desc: "Files are chunked and stored as 768D numerical vectors alongside the source of that chunk, so a citation can be opened and read.",
  },
  {
    icon: Lock,
    tone: "text-ok",
    title: "What's Never Stored",
    desc: "OAuth tokens are AES-256 encrypted at rest. DRAG never writes commits, opens pull requests, or shares vectors across accounts.",
  },
  {
    icon: ShieldCheck,
    tone: "text-accent",
    title: "Access Mirroring",
    desc: "Every repository query is checked against your live GitHub permissions. Revoke access on GitHub and DRAG drops it within the hour.",
  },
  {
    icon: RefreshCw,
    tone: "text-danger",
    title: "Disconnect Anytime",
    desc: "Disconnecting a repository deletes your chat histories immediately. Indexed files and embeddings are purged once the last connected account disconnects.",
  },
];

export function TrustSection() {
  return (
    <section
      id="trust-security"
      className="border-b border-line bg-page-2 transition-colors duration-200 ease-out"
    >
      <div className={`${PAGE_CONTAINER} pt-24 pb-28`}>
        <div className="mx-auto mb-16 max-w-[800px] text-center">
          <h2 className="font-display text-[clamp(2rem,3.8vw,3rem)] font-semibold tracking-display text-ink">
            Built for private codebases.
          </h2>
          <p className="mt-4 text-[17px] leading-[26px] text-ink-3">
            DRAG only stores what it strictly needs to compute embeddings and answer your questions.
          </p>
        </div>

        <div className="grid gap-6 max-lg:grid-cols-2 lg:grid-cols-4">
          {TRUST_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="flex flex-col items-center gap-3 rounded-[12px] border border-line bg-surface px-5 py-7 text-center transition-colors duration-200 ease-out"
              >
                <div className="mb-1 flex size-12 items-center justify-center rounded-[12px] border border-line bg-surface-2 shadow-card">
                  <Icon size={22} aria-hidden className={card.tone} />
                </div>
                <h4 className="text-base font-bold tracking-[-0.02em] text-ink">{card.title}</h4>
                <p className="text-sm leading-[1.6] font-medium text-ink-3">{card.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
