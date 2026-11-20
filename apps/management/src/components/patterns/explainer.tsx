"use client";
import { useState, type ReactNode } from "react";
import { ChevronRightIcon, InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How a page works, folded to one line until someone wants it. Pages used to lead with these as permanent
 * boxes; people who know the rules no longer read past them. Whether it is open is remembered per explainer.
 */
export function Explainer({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  const key = `apicenter.explainer.${id}`;
  const [open, setOpen] = useState(() => read(key));
  const toggle = () => {
    setOpen(!open);
    write(key, !open);
  };
  return (
    <div className={cn("rounded-lg border bg-muted/30 text-[13px]", className)}>
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-muted-foreground hover:text-foreground">
        <InfoIcon aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 font-medium">{title}</span>
        <ChevronRightIcon aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {open ? <div className="border-t px-4 py-3 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "open";
  } catch {
    return false;
  }
}

function write(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? "open" : "folded");
  } catch {
    // Remembering it is a convenience only.
  }
}
