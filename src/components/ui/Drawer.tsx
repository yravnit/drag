"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Counts into the header, e.g. the citation total. */
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, badge, children, footer, className }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/40 animate-fade-in lg:hidden"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-full max-w-[min(380px,90vw)] flex-col",
          "animate-slide-in-right border-l border-chat-line bg-chat shadow-[6px_0_30px_rgba(0,0,0,0.25)]",
          "lg:static lg:z-auto lg:max-w-none lg:animate-none lg:shadow-none",
          className,
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-chat-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-[13px] font-semibold text-chat-ink">{title}</h2>
            {badge}
          </div>
          <IconButton onClick={onClose} aria-label="Close panel">
            <X className="size-4" aria-hidden />
          </IconButton>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>

        {footer ? <footer className="border-t border-chat-line px-4 py-3">{footer}</footer> : null}
      </aside>
    </>
  );
}