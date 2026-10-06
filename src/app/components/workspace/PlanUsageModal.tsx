"use client";

import React, { useEffect, useState } from "react";
import { X, Check, Shield, Building2 } from "lucide-react";
import { formatLimit } from "./formatters";
import type { PlanUsageData } from "./types";

interface PlanUsageModalProps {
  isOpen: boolean;
  onClose: () => void;
  planUsage: PlanUsageData | null;
}

export function PlanUsageModal({
  isOpen,
  onClose,
  planUsage,
}: PlanUsageModalProps) {
  const [contactNotice, setContactNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentPlan = planUsage?.plan || "free";
  const entitlements = planUsage?.entitlements;
  const usage = planUsage?.usage;

  const handleUpgradeClick = (targetPlan: string) => {
    if (targetPlan === "hobby") {
      setContactNotice("Hobby plan automated checkout is coming soon. Please contact our team for early activation.");
    } else if (targetPlan === "enterprise") {
      setContactNotice("Contact sales for custom pricing and dedicated infrastructure setup.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-100" onClick={onClose}>
      <div className="relative w-full max-w-3xl bg-[#0f0f12] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 bg-zinc-950/40">
          <div>
            <h3 className="text-base font-bold text-white">Subscription & Usage</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Manage your DRAG workspace tier and review your monthly limits.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-900 active:scale-90 rounded-lg text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
            title="Close modal (Esc)"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Boss plan status */}
          {currentPlan === "boss" && (
            <div className="p-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-yellow-950/20 to-zinc-950 text-xs text-amber-200 space-y-1">
              <div className="font-bold text-sm text-amber-300">
                BOSS Mode Active
              </div>
              <p className="text-zinc-300 text-[11px] leading-relaxed">
                Infinite repositories, unmetered monthly queries, all branch selection unlocked, unlimited file count and storage. Reserved exclusively for the workspace administrator.
              </p>
            </div>
          )}

          {/* Current Usage Status (Free / Hobby limits display) */}
          {entitlements && usage && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">
                Current usage
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Repositories usage */}
                <div className="p-3.5 rounded-lg bg-zinc-900/50 border border-zinc-850">
                  <div className="text-[11px] text-zinc-400 font-medium">Repositories</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-white">
                      {usage.repositoriesCount}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono">
                      / {formatLimit(entitlements.repositoryLimit)}
                    </span>
                  </div>
                  <div className="mt-2 w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-teal-400 h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (usage.repositoriesCount / entitlements.repositoryLimit) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* RAG query quota usage */}
                <div className="p-3.5 rounded-lg bg-zinc-900/50 border border-zinc-850">
                  <div className="text-[11px] text-zinc-400 font-medium">RAG queries</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-white">
                      {usage.monthlyQueriesCount}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono">
                      {entitlements.monthlyQueryLimit !== null
                        ? `/ ${formatLimit(entitlements.monthlyQueryLimit)} this month`
                        : "queries this month (unmetered)"}
                    </span>
                  </div>
                  {entitlements.monthlyQueryLimit !== null && (
                    <div className="mt-2 w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-teal-400 h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (usage.monthlyQueriesCount / entitlements.monthlyQueryLimit) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Pricing Tiers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Free Tier */}
            <div
              className={`p-5 rounded-xl border flex flex-col justify-between transition ${
                currentPlan === "free"
                  ? "border-teal-500/50 bg-teal-950/10 shadow-sm ring-1 ring-teal-500/20"
                  : "border-zinc-800 bg-zinc-950/20"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-white">Free</h4>
                  {currentPlan === "free" && (
                    <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/20">
                      Current
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-extrabold text-white">₹0</span>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  Free plan for personal experimentation
                </p>

                <ul className="mt-4 space-y-2 text-xs text-zinc-300">
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>2 repositories</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>25 queries / month</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>50 MB repository size</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>2,500 files</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-900">
                {currentPlan === "free" ? (
                  <button
                    disabled
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-400 text-center cursor-default"
                  >
                    Active Plan
                  </button>
                ) : (
                  <span className="text-[11px] text-zinc-500 block text-center">Included</span>
                )}
              </div>
            </div>

            {/* Hobby Tier */}
            <div
              className={`p-5 rounded-xl border flex flex-col justify-between transition ${
                currentPlan === "hobby"
                  ? "border-teal-500/50 bg-teal-950/10 shadow-sm ring-1 ring-teal-500/20"
                  : "border-zinc-800 bg-zinc-950/20"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-white">Hobby</h4>
                  {currentPlan === "hobby" && (
                    <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/20">
                      Current
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <span className="text-2xl font-extrabold text-white">₹499</span>
                  <span className="text-xs text-zinc-400">/month</span>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  Hobby plan for active developers
                </p>

                <ul className="mt-4 space-y-2 text-xs text-zinc-300">
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>10 repositories</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>Higher query quota</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>250 MB repository size</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>12,500 files</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                    <span>Incremental reindexing</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-900">
                {currentPlan === "hobby" ? (
                  <button
                    disabled
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-400 text-center cursor-default"
                  >
                    Active Plan
                  </button>
                ) : currentPlan === "free" ? (
                  <button
                    onClick={() => handleUpgradeClick("hobby")}
                    className="w-full py-2 px-3 rounded-lg text-xs font-bold bg-teal-500 hover:bg-teal-400 active:scale-[0.98] text-zinc-950 transition cursor-pointer shadow"
                  >
                    Upgrade to Hobby
                  </button>
                ) : (
                  <span className="text-[11px] text-zinc-500 block text-center">Included</span>
                )}
              </div>
            </div>

            {/* Enterprise Tier */}
            <div
              className={`p-5 rounded-xl border flex flex-col justify-between transition ${
                currentPlan === "enterprise"
                  ? "border-teal-500/50 bg-teal-950/10 shadow-sm ring-1 ring-teal-500/20"
                  : "border-zinc-800 bg-zinc-950/20"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-purple-400" />
                    <h4 className="font-bold text-sm text-white">Enterprise</h4>
                  </div>
                  {currentPlan === "enterprise" && (
                    <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                      Current
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <span className="text-xl font-extrabold text-white">₹15,000*</span>
                  <span className="text-xs text-zinc-400">/month</span>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  *Contact sales for custom pricing
                </p>

                <ul className="mt-4 space-y-2 text-xs text-zinc-300">
                  <li className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                    <span>Custom repository limits</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                    <span>Negotiated query quota</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                    <span>Custom repository sizes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                    <span>Dedicated SLAs</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-900">
                {currentPlan === "enterprise" ? (
                  <button
                    disabled
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-400 text-center cursor-default"
                  >
                    Active Plan
                  </button>
                ) : currentPlan === "free" ? (
                  <button
                    onClick={() => handleUpgradeClick("enterprise")}
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] text-zinc-200 transition cursor-pointer"
                  >
                    Contact sales for custom pricing
                  </button>
                ) : (
                  <span className="text-[11px] text-zinc-500 block text-center">Included</span>
                )}
              </div>
            </div>
          </div>

          {/* Contact notice alert if triggered */}
          {contactNotice && (
            <div className="p-3 bg-zinc-900 border border-zinc-750 rounded-xl text-xs text-zinc-300 flex items-center justify-between">
              <span>{contactNotice}</span>
              <button
                onClick={() => setContactNotice(null)}
                className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 active:scale-90 transition cursor-pointer" title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
