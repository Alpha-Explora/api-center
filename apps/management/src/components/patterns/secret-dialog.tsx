"use client";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Shows a secret exactly once. Only a verifier is stored, so closing the dialog loses it; the person has to
 * say they stored it.
 */
export function SecretDialog({
  secret,
  title,
  description,
  details,
  onClose,
}: {
  secret: string | null;
  title: string;
  description: ReactNode;
  details?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()} disablePointerDismissal>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <code className="block rounded-md border bg-muted px-3 py-2.5 font-mono text-xs break-all select-all">{secret}</code>
        {details}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(secret ?? "").then(
                () => toast.success("Copied"),
                () => toast.error("Copy was blocked; select the secret and copy it manually"),
              );
            }}
          >
            Copy
          </Button>
          <Button onClick={onClose}>I stored it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
