"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    // Prevent the page behind the overlay scrolling. Restored on close, including
    // when this unmounts while still open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasCustomMaxWidth = className ? /\bmax-w-/.test(className) : false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full animate-zoom-in overflow-hidden rounded-[16px] border border-line bg-page-2 flex flex-col",
          !hasCustomMaxWidth && "max-w-lg",
          "shadow-[0_24px_64px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg tracking-display text-ink">{title}</h2>
            {description ? <p className="mt-1 text-[13px] text-ink-3">{description}</p> : null}
          </div>
          <IconButton onClick={onClose} aria-label="Close dialog">
            <X className="size-4" aria-hidden />
          </IconButton>
        </header>

        <div className="scroll-thin flex-1 min-h-0 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <footer className="shrink-0 flex items-center justify-end gap-3 border-t border-line bg-chat-2 px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}