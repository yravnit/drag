"use client";

import { useEffect, useRef, useState } from "react";

export interface UseInViewFadeOptions {
  /** Fraction of the element that must be visible before it counts as in view. */
  threshold?: number;
  /** Fire once and stop observing (the default). Set false to re-trigger on every entry. */
  once?: boolean;
}

/**
 * Reveals an element when it scrolls into view. Returns the ref to attach and the
 * flag to animate on.
 */
export function useInViewFade({ threshold = 0.2, once = true }: UseInViewFadeOptions = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);

  return { ref, inView };
}