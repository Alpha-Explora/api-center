import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ServiceStatus } from "@/lib/schemas";

export function StatusBadge({ status }: { status: ServiceStatus }) {
  const classes =
    status === "active"
      ? "border-transparent bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
      : status === "deprecated"
        ? "border-transparent bg-[#fff8e7] text-[#9a5b00]"
        : "border-transparent bg-[#fff1f1] text-[#b42318]";

  return (
    <Badge variant="secondary" className={cn("gap-1.5", classes)}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </Badge>
  );
}
