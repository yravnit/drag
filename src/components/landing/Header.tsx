"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { GithubIcon } from "@/components/ui/GithubIcon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PRIMARY_CTA, REPO_URL } from "./constants";

const NAV_SECTIONS = [
  { id: "how-it-works", label: "How It Works" },
  { id: "trust-security", label: "Security", mobileLabel: "Trust & Security" },
];

interface TrackerBox {
  left: number;
  width: number;
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tracker, setTracker] = useState<TrackerBox | null>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.scrollY + window.innerHeight * 0.35;
      let current: string | null = null;
      for (const section of NAV_SECTIONS) {
        const node = document.getElementById(section.id);
        if (node && node.getBoundingClientRect().top + window.scrollY <= line) current = section.id;
      }
      setActiveId(current);
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };
    scheduleMeasure();
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      window.removeEventListener("scroll", scheduleMeasure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const node = activeId ? linkRefs.current[activeId] : null;
    setTracker(node ? { left: node.offsetLeft, width: node.offsetWidth } : null);
  }, [activeId]);

  useEffect(() => {
    const onResize = () => {
      const node = activeId ? linkRefs.current[activeId] : null;
      setTracker(node ? { left: node.offsetLeft, width: node.offsetWidth } : null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeId]);

  return (
    <>
      <header className="sticky top-0 z-50 hidden h-[72px] items-center justify-between border-b border-header-line bg-header px-16 shadow-[0_1px_3px_rgba(0,0,0,0.03)] backdrop-blur-[16px] transition-colors duration-200 ease-out md:flex">
        <Link href="/" aria-label="DRAG home" className="flex items-center gap-2.5">
          <span className="font-brand text-[22px] leading-none text-ink">DRAG</span>
        </Link>

        <nav
          aria-label="Main navigation"
          className="relative flex items-center gap-8 text-[14.5px] font-semibold tracking-[-0.02em] text-ink-3"
        >
          <span
            aria-hidden
            style={
              {
                "--tracker-left": `${tracker?.left ?? 0}px`,
                "--tracker-width": `${tracker?.width ?? 0}px`,
              } as React.CSSProperties
            }
            className={cn(
              "pointer-events-none absolute top-1/2 left-[var(--tracker-left)] z-0 h-8 w-[var(--tracker-width)] -translate-y-1/2 rounded-[8px] bg-btn shadow-[0_4px_14px_rgba(0,0,0,0.16)]",
              "transition-[left,width] transition-opacity duration-300 ease-out",
              activeId ? "opacity-100" : "opacity-0",
            )}
          />
          {NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              ref={(node) => {
                linkRefs.current[section.id] = node;
              }}
              aria-current={activeId === section.id ? "true" : undefined}
              className={cn(
                "relative z-10 whitespace-nowrap rounded-[8px] px-3 py-1.5 transition-colors duration-100 ease-out hover:text-ink",
                activeId === section.id ? "text-btn-fg" : undefined,
              )}
            >
              {section.label}
            </a>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 py-1.5 transition-colors duration-100 ease-out hover:text-ink"
          >
            <GithubIcon className="size-4" />
            <span>Open Source</span>
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/workspace" className={cn(PRIMARY_CTA, "h-[42px] px-[22px] text-sm")}>
            <span>Sign in with GitHub</span>
          </Link>
        </div>
      </header>

      <header className="sticky top-0 z-50 border-b border-header-line bg-header backdrop-blur-[12px] md:hidden">
        <div className="flex h-15 w-full items-center justify-between px-5">
          <Link href="/" aria-label="DRAG home">
            <span className="font-brand text-xl text-ink">DRAG</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
              className="flex cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent p-1 text-ink transition-transform duration-100 ease-out"
            >
              {mobileOpen ? (
                <X size={24} strokeWidth={2} aria-hidden />
              ) : (
                <Menu size={24} strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
        </div>
      </header>

      <div
        inert={!mobileOpen}
        className={cn(
          "fixed inset-x-0 top-15 bottom-0 z-40 overflow-y-auto bg-page px-5 pt-7 pb-12 md:hidden",
          "transition-[opacity,transform] duration-200 ease-out",
          mobileOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <nav
          aria-label="Mobile navigation"
          className="flex flex-col gap-6 text-[17px] font-semibold text-ink"
        >
          {NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={() => setMobileOpen(false)}
              className="rounded-[4px] transition-colors duration-100 ease-out hover:text-ink-3"
            >
              {section.mobileLabel ?? section.label}
            </a>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 transition-colors duration-100 ease-out hover:text-ink-3"
          >
            <GithubIcon className="size-4" />
            <span>Open Source</span>
          </a>
          <div className="mt-3">
            <Link
              href="/workspace"
              onClick={() => setMobileOpen(false)}
              className={cn(PRIMARY_CTA, "h-12 w-full text-base")}
            >
              <span>Sign in with GitHub</span>
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}
