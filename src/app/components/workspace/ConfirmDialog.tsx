"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  /** Failure from the confirmed action, shown in place of a silent no-op. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-app replacement for window.confirm: focus-trapped, Esc-dismissible, dark-theme. */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    confirmRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-100"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0f0f12] p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-950/40 border border-red-900/50 text-red-400">
            <AlertTriangle className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">{message}</p>
            {error && (
              <p
                role="alert"
                className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-[11px] text-red-400"
              >
                <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-zinc-900 hover:text-white active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-red-400 active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}