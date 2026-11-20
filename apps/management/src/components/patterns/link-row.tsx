"use client";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A table row that opens `href` when clicked anywhere. Put a real link on the row's name for keyboard and
 * screen-reader users; clicks on links, buttons and inputs inside the row keep their own behaviour.
 */
export function LinkRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <TableRow
      className={cn("group cursor-pointer", className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button, input, select, textarea, [role=button]")) return;
        if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
        else router.push(href);
      }}
    >
      {children}
      <TableCell className="w-0 pr-3 text-right">
        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
      </TableCell>
    </TableRow>
  );
}
