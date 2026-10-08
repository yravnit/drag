"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface ConfirmDialogProps {
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

/** In-app replacement for window.confirm: Esc-dismissible, focus-on-open, modal backdrop. */
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
  return (
    <Modal
      open={isOpen}
      onClose={onCancel}
      title={title}
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={pending} autoFocus>
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-3">{message}</p>
      {error && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-1.5 rounded-control border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger"
        >
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </Modal>
  );
}
