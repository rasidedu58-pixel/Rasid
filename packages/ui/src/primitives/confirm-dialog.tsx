"use client";

import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * The one shared confirmation pattern for irreversible/consequential
 * actions (reverse a payment, archive a student, disable a member...).
 * Never closes itself on confirm — the caller closes it only after the
 * mutation actually succeeds (rule §4.12: never claim success before the
 * server confirms it).
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "تأكيد", cancelLabel = "إلغاء", destructive, loading, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hook form of ConfirmDialog for the common "click action -> confirm -> mutate" flow without hand-rolling state per call site. */
export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen, openDialog: () => setOpen(true), closeDialog: () => setOpen(false) };
}
