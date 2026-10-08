"use client";

import { useEffect, useState } from "react";

/**
 * Tracks `prefers-reduced-motion`. Callers use it to skip a count-up or a
 * transition, not merely to shorten it — CSS already neutralises the animation
 * itself via the global reduced-motion block in `globals.css`.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefers(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefers(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return prefers;
}