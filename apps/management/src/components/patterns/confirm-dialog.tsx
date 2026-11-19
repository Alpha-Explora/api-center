"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Asks before a destructive or hard-to-reverse action. With `reasonLabel`, a reason is required and passed
 * to `onConfirm`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  reasonLabel,
  busy = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  reasonLabel?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const needsReason = Boolean(reasonLabel);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (needsReason && !reason.trim()) return;
            onConfirm(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {needsReason ? (
            <label className="flex flex-col gap-1.5 text-[13px]">
              <span className="font-medium">{reasonLabel}</span>
              <Textarea autoFocus rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || (needsReason && !reason.trim())}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
