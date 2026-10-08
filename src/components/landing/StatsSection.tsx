"use client";

import { useEffect, useState } from "react";
import { useInViewFade } from "@/hooks/useInViewFade";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { PAGE_CONTAINER } from "./constants";

const COUNT_DURATION_MS = 800;

const easeOutCubic = (progress: number) => 1 - (1 - progress) ** 3;

function useCountUp(target: number, active: boolean, instant: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (instant) {
      setValue(target);
      return;
    }

    let startedAt: number | null = null;
    let frame = requestAnimationFrame(function step(timestamp: number) {
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min((timestamp - startedAt) / COUNT_DURATION_MS, 1);
      setValue(Math.floor(easeOutCubic(progress) * target));
      if (progress < 1) frame = requestAnimationFrame(step);
    });

    return () => cancelAnimationFrame(frame);
  }, [target, active, instant]);

  return value;
}

export function StatsSection() {
  const prefersReduced = usePrefersReducedMotion();
  const { ref, inView } = useInViewFade({ threshold: 0.4, once: true });
  const dimensions = useCountUp(768, inView, prefersReduced);
  const files = useCountUp(50_000, inView, prefersReduced);

  const stats = [
    { value: `${dimensions}D`, label: "Embedding Dimensions" },
    { value: `Up to ${files.toLocaleString()}`, label: "Files per Repository" },
    { value: "Up to 1 GB", label: "Repository Size Limit" },
    { value: "< 500ms", label: "Incremental Sync Speed" },
  ];

  return (
    <section
      ref={ref}
      className="border-b border-line bg-page-2 transition-colors duration-200 ease-out"
    >
      <div className={`${PAGE_CONTAINER} py-16`}>
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-6">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <span className="inline-block font-display text-5xl leading-none font-semibold tracking-display whitespace-nowrap tabular-nums text-ink">
                {stat.value}
              </span>
              <div className="mt-2.5 text-sm font-semibold tracking-[-0.02em] text-ink-3">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
