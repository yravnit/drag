"use client";
import { memo, useState } from "react";
import { Check, Shield, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatLimit } from "./formatters";
import type { PlanUsageData } from "./types";

interface PlanUsageModalProps {
  isOpen: boolean;
  onClose: () => void;
  planUsage: PlanUsageData | null;
}

interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
  suffix?: string;
  metered: boolean;
}

function UsageMeter({
  label,
  used,
  limit,
  suffix,
  metered,
}: UsageMeterProps) {
  const percent = metered && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="rounded-control border border-line bg-surface p-3.5">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-ink">{used}</span>
        <span className="font-mono text-xs text-ink-4">
          {metered ? `/ ${formatLimit(limit)} ${suffix ?? ""}` : `${suffix ?? ""} (unmetered)`}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-1.5 rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function PlanUsageModalImpl({ isOpen, onClose, planUsage }: PlanUsageModalProps) {
  const [contactNotice, setContactNotice] = useState<string | null>(null);

  const currentPlan = planUsage?.plan || "free";
  const entitlements = planUsage?.entitlements;
  const usage = planUsage?.usage;

  const handleUpgradeClick = (targetPlan: string) => {
    if (targetPlan === "hobby") {
      setContactNotice(
        "Hobby plan automated checkout is coming soon. Please contact our team for early activation.",
      );
    } else if (targetPlan === "enterprise") {
      setContactNotice(
        "Contact sales for custom pricing and dedicated infrastructure setup.",
      );
    }
  };

  const isCurrent = (plan: string) => currentPlan === plan;
  const isUpgradeable = currentPlan === "free";

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Subscription & Usage"
      description="Manage your DRAG workspace tier and review your monthly limits."
      className="max-w-4xl h-[82vh] max-h-[780px] min-h-[580px]"
    >
      <div className="space-y-5">
        {currentPlan === "boss" && (
          <div className="space-y-1 rounded-card border border-accent/40 bg-accent-soft p-4 text-xs text-ink-2">
            <div className="flex items-center gap-2">
              <Shield className="size-4 shrink-0 text-accent-ink" aria-hidden />
              <span className="text-sm font-bold text-accent-ink">BOSS Mode Active</span>
            </div>
            <p className="leading-relaxed">
              Infinite repositories, unmetered monthly queries, all branch selection unlocked,
              unlimited file count and storage. Reserved exclusively for the workspace
              administrator.
            </p>
          </div>
        )}

        {entitlements && usage && (
          <div className="rounded-card border border-line bg-surface-2 p-4">
            <h4 className="mb-3 text-xs font-bold tracking-wider text-ink-3 uppercase">
              Current usage
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UsageMeter
                label="Repositories"
                used={usage.repositoriesCount}
                limit={entitlements.repositoryLimit}
                metered={entitlements.repositoryLimit > 0}
              />
              <UsageMeter
                label="RAG queries"
                used={usage.monthlyQueriesCount}
                limit={entitlements.monthlyQueryLimit ?? 0}
                suffix="this month"
                metered={entitlements.monthlyQueryLimit !== null}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div
            className={`flex flex-col justify-between rounded-card border p-4 ${
              isCurrent("free") ? "border-accent/50 bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-ink">Free</h4>
                {isCurrent("free") && <Badge tone="accent">Current</Badge>}
              </div>
              <div className="mt-3 text-2xl font-extrabold text-ink">₹0</div>
              <p className="mt-1.5 text-xs text-ink-3">Free plan for personal experimentation</p>
              <ul className="mt-4 space-y-1.5 text-xs text-ink-2">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  2 repositories
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  25 queries / month
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  50 MB repository size
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  2,500 files
                </li>
              </ul>
            </div>
            <div className="mt-5 border-t border-line pt-3">
              {isCurrent("free") ? (
                <Button size="sm" disabled className="w-full">
                  Active Plan
                </Button>
              ) : (
                <span className="block text-center text-xs text-ink-4">Included</span>
              )}
            </div>
          </div>

          <div
            className={`flex flex-col justify-between rounded-card border p-4 ${
              isCurrent("hobby")
                ? "border-accent/50 bg-accent-soft"
                : "border-line bg-surface"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-ink">Hobby</h4>
                {isCurrent("hobby") && <Badge tone="accent">Current</Badge>}
              </div>
              <div className="mt-3 text-2xl font-extrabold text-ink">₹499</div>
              <span className="text-xs text-ink-3">/month</span>
              <p className="mt-1.5 text-xs text-ink-3">Hobby plan for active developers</p>
              <ul className="mt-4 space-y-1.5 text-xs text-ink-2">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  10 repositories
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  Higher query quota
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  250 MB repository size
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  12,500 files
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  Incremental reindexing
                </li>
              </ul>
            </div>
            <div className="mt-5 border-t border-line pt-3">
              {isCurrent("hobby") ? (
                <Button size="sm" disabled className="w-full">
                  Active Plan
                </Button>
              ) : isUpgradeable ? (
                <Button size="sm" className="w-full" onClick={() => handleUpgradeClick("hobby")}>
                  Upgrade to Hobby
                </Button>
              ) : (
                <span className="block text-center text-xs text-ink-4">Included</span>
              )}
            </div>
          </div>

          <div
            className={`flex flex-col justify-between rounded-card border p-4 ${
              isCurrent("enterprise")
                ? "border-accent/50 bg-accent-soft"
                : "border-line bg-surface"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-ink">Enterprise</h4>
                {isCurrent("enterprise") && <Badge tone="accent">Current</Badge>}
              </div>
              <div className="mt-3 text-2xl font-extrabold text-ink">₹15,000*</div>
              <span className="text-xs text-ink-3">/month</span>
              <p className="mt-1.5 text-xs text-ink-3">*Contact sales for custom pricing</p>
              <ul className="mt-4 space-y-1.5 text-xs text-ink-2">
                <li className="flex items-center gap-2">
                  <Shield className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  Custom repository limits
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  Negotiated query quota
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  Custom repository sizes
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                  Dedicated SLAs
                </li>
              </ul>
            </div>
            <div className="mt-5 border-t border-line pt-3">
              {isCurrent("enterprise") ? (
                <Button size="sm" disabled className="w-full">
                  Active Plan
                </Button>
              ) : isUpgradeable ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleUpgradeClick("enterprise")}
                >
                  Contact sales for custom pricing
                </Button>
              ) : (
                <span className="block text-center text-xs text-ink-4">Included</span>
              )}
            </div>
          </div>
        </div>

        {contactNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-2 p-3 text-xs text-ink-2"
          >
            <span>{contactNotice}</span>
            <button
              type="button"
              onClick={() => setContactNotice(null)}
              aria-label="Dismiss notice"
              title="Dismiss"
              className="cursor-pointer rounded-[4px] p-0.5 text-ink-4 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// memo: composer keystrokes change only messageText, which none of these read.
export const PlanUsageModal = memo(PlanUsageModalImpl);
