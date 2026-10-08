"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NvidiaModelOption } from "./types";

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  defaultModelName?: string;
  dropdownPlacement?: "up" | "down";
  manuallyPicked?: boolean;
  onManualPick?: () => void;
}

/** Picks the verified model with the lowest probe latency; null when no model reports one. */
function fastestModel(models: NvidiaModelOption[]): NvidiaModelOption | null {
  return models.reduce<NvidiaModelOption | null>((best, model) => {
    if (model.latencyMs === null) return best;
    if (!best || best.latencyMs === null || model.latencyMs < best.latencyMs) return model;
    return best;
  }, null);
}

export function ModelSelector({
  selectedModel,
  onSelectModel,
  defaultModelName = "Default LLM",
  dropdownPlacement = "down",
  manuallyPicked: manuallyPickedProp,
  onManualPick,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [nvidiaModels, setNvidiaModels] = useState<NvidiaModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [internalManuallyPicked, setInternalManuallyPicked] = useState(false);
  const isManuallyPicked =
    manuallyPickedProp !== undefined ? manuallyPickedProp : internalManuallyPicked;
  const onSelectModelRef = useRef(onSelectModel);

  useEffect(() => {
    onSelectModelRef.current = onSelectModel;
  }, [onSelectModel]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    fetch("/api/nvidia-models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data?.models && Array.isArray(data.models)) {
          const models = data.models as NvidiaModelOption[];
          setNvidiaModels(models);

          // The default model is the fastest verified one. A manual pick always wins,
          // and with no latency reported the configured default LLM stays selected.
          const fastest = fastestModel(models);
          if (fastest && !isManuallyPicked && selectedModel === "default") {
            onSelectModelRef.current(fastest.id);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to fetch NVIDIA models:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isManuallyPicked, selectedModel]);

  const isDefault = selectedModel === "default" || !selectedModel;
  const displayLabel = isDefault
    ? defaultModelName
    : selectedModel.includes("/")
      ? selectedModel.split("/")[1]
      : selectedModel;

  const handleSelect = (modelId: string) => {
    setInternalManuallyPicked(true);
    onManualPick?.();
    onSelectModel(modelId);
    setIsOpen(false);
  };

  const optionClass = (isSelected: boolean) =>
    cn(
      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors duration-150",
      isSelected ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-3",
    );

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        title="Select AI Chat Model"
        className="inline-flex h-8 max-w-[140px] items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-xs font-medium text-ink-2 transition-[border-color,color] duration-150 hover:border-line-2 hover:text-ink active:scale-[0.97] sm:max-w-[200px]"
      >
        <Cpu className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
        <span className="truncate">{displayLabel}</span>
        <ChevronDown className="size-3 shrink-0 text-ink-4" aria-hidden />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className={cn(
              "absolute z-50 w-72 max-w-[calc(100vw-2rem)] animate-zoom-in overflow-hidden rounded-card border border-line bg-page-2 py-1.5 text-xs shadow-pop",
              dropdownPlacement === "up" ? "bottom-full mb-2 left-0" : "mt-1.5 left-0",
            )}
          >
            <div className="px-3 py-1 text-[10px] font-bold tracking-wider text-ink-4 uppercase">
              Default Provider
            </div>
            <button
              type="button"
              onClick={() => handleSelect("default")}
              className={optionClass(isDefault)}
            >
              <span className="min-w-0 truncate">
                <span className="block truncate">{defaultModelName}</span>
                <span className="block truncate font-mono text-[10px] text-ink-4">
                  Configured default LLM
                </span>
              </span>
              {isDefault && <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />}
            </button>

            <div className="mt-1 border-t border-line pt-1">
              <div className="flex items-center justify-between px-3 py-1 text-[10px] font-bold tracking-wider text-ink-4 uppercase">
                <span>LLMs</span>
                {loading && <span className="text-[10px] normal-case">loading...</span>}
              </div>

              {nvidiaModels.length === 0 && !loading ? (
                <p className="px-3 py-2 text-[11px] text-ink-4">No models currently verified.</p>
              ) : (
                <div className="scroll-thin max-h-48 overflow-y-auto">
                  {nvidiaModels.map((model) => {
                    const isSelected = selectedModel === model.id;
                    const cleanName = model.id.includes("/")
                      ? model.id.split("/")[1]
                      : model.id;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleSelect(model.id)}
                        className={optionClass(isSelected)}
                      >
                        <span className="min-w-0 flex-1 pr-2">
                          <span className="block truncate">{cleanName}</span>
                          <span className="block truncate font-mono text-[10px] text-ink-4">
                            {model.id}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {model.latencyMs !== null && (
                            <span className="inline-flex items-center gap-0.5 rounded-chip border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                              <Zap className="size-2.5 text-amber-500" aria-hidden />
                              {model.latencyMs}ms
                            </span>
                          )}
                          {isSelected && (
                            <Check className="size-3.5 text-accent-ink" aria-hidden />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
