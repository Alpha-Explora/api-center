"use client";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      className={cn("text-muted-foreground", className)}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => toast.error("Copy was blocked; select the text and copy it manually"),
        );
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/** A monospace identifier with a copy button. */
export function IdText({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-0.5 font-mono text-xs text-muted-foreground", className)}>
      <span className="truncate">{value}</span>
      <CopyButton value={value} label={`Copy ${value}`} />
    </span>
  );
}
