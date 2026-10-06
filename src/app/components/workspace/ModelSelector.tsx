"use client";

import React, { useEffect, useRef, useState } from "react";
import { Cpu, ChevronDown, Check, Zap } from "lucide-react";
import type { NvidiaModelOption } from "./types";

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  defaultModelName?: string;
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
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [nvidiaModels, setNvidiaModels] = useState<NvidiaModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const manuallyPicked = useRef(false);
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
          if (fastest && !manuallyPicked.current) {
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
  }, []);

  const displayLabel =
    selectedModel === "default" || !selectedModel
      ? defaultModelName
      : selectedModel.includes("/")
        ? selectedModel.split("/")[1]
        : selectedModel;

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-850 hover:border-zinc-600 active:scale-95 text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer"
        title="Select AI Chat Model"
      >
        <Cpu className="h-3.5 w-3.5 text-teal-400" />
        <span className="truncate max-w-[140px] sm:max-w-[200px]">{displayLabel}</span>
        <ChevronDown className="h-3 w-3 text-zinc-500" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-1.5 w-72 rounded-xl border border-zinc-800 bg-[#0f0f12] shadow-2xl z-50 py-1.5 text-xs text-zinc-200 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
            {/* Default Provider Section */}
            <div className="px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              Default Provider
            </div>
            <button
              type="button"
              onClick={() => {
                manuallyPicked.current = true;
                onSelectModel("default");
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/80 active:bg-zinc-800 transition cursor-pointer ${
                selectedModel === "default" || !selectedModel
                  ? "text-teal-400 font-semibold bg-teal-500/10"
                  : "text-zinc-300"
              }`}
            >
              <div className="truncate">
                <div>{defaultModelName}</div>
                <div className="text-[10px] text-zinc-500 font-mono">Configured default LLM</div>
              </div>
              {(selectedModel === "default" || !selectedModel) && (
                <Check className="h-3.5 w-3.5 text-teal-400 shrink-0" />
              )}
            </button>

            {/* Available Models Section */}
            <div className="mt-1 pt-1 border-t border-zinc-900">
              <div className="px-3 py-1 flex items-center justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                <span>LLMs</span>
                {loading && <span className="text-[9px] lowercase text-zinc-600">loading...</span>}
              </div>

              {nvidiaModels.length === 0 && !loading ? (
                <div className="px-3 py-2 text-zinc-500 text-[11px]">
                  No models currently verified.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  {nvidiaModels.map((m) => {
                    const isSelected = selectedModel === m.id;
                    const cleanName = m.id.includes("/") ? m.id.split("/")[1] : m.id;

                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          manuallyPicked.current = true;
                          onSelectModel(m.id);
                          setIsOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-zinc-800/80 active:bg-zinc-800 transition cursor-pointer ${
                          isSelected
                            ? "text-teal-400 font-semibold bg-teal-500/10"
                            : "text-zinc-300"
                        }`}
                      >
                        <div className="truncate pr-2">
                          <div className="truncate">{cleanName}</div>
                          <div className="text-[10px] text-zinc-500 font-mono truncate">{m.id}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {m.latencyMs !== null && (
                            <span className="flex items-center text-[10px] text-zinc-400 font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                              <Zap className="h-2.5 w-2.5 text-amber-400 mr-0.5" />
                              {m.latencyMs}ms
                            </span>
                          )}
                          {isSelected && <Check className="h-3.5 w-3.5 text-teal-400" />}
                        </div>
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
