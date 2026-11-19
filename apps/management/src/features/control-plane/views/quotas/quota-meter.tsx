"use client";
import { cn } from "@/lib/utils";
import { formatNumber, formatRelative } from "@/lib/format";
import { meterLevel, type QuotaMeter } from "../../model/observability";

const FILL = {
  success: "bg-foreground/70",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground",
} as const;

/** "resets in 2 hours"; a window ending within a minute reads "resets in under a minute". */
function resetsIn(windowEnd: string) {
  return Date.parse(windowEnd) - Date.now() < 60_000 ? "resets in under a minute" : `resets ${formatRelative(windowEnd)}`;
}

/** A thin progress bar for a request budget's current window, with the count and when it resets. */
export function QuotaMeterBar({ meter, compact = false, className }: { meter: QuotaMeter | undefined; compact?: boolean; className?: string }) {
  if (!meter) return <span className={cn("text-xs text-muted-foreground", className)}>No usage reported</span>;
  if (meter.used === null) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>{meter.limit === null ? "Unlimited; not counted" : "Not counting while disabled"}</span>
    );
  }
  const level = meterLevel(meter);
  const label = `${formatNumber(meter.used)} of ${formatNumber(meter.limit)} used${level ? ` (${Math.floor(level.percent)}%)` : ""}`;
  return (
    <div className={cn("flex min-w-32 flex-col gap-1", className)}>
      <div
        role="meter"
        aria-label="Requests used in the current window"
        aria-valuemin={0}
        aria-valuemax={meter.limit ?? undefined}
        aria-valuenow={meter.used}
        aria-valuetext={label}
        className={cn("w-full overflow-hidden rounded-full bg-muted", compact ? "h-1" : "h-1.5")}
      >
        <div className={cn("h-full rounded-full transition-[width]", FILL[level?.tone ?? "neutral"])} style={{ width: `${level?.percent ?? 0}%` }} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className={cn("whitespace-nowrap tabular-nums", level?.tone === "danger" ? "text-danger" : level?.tone === "warning" ? "text-warning" : "text-foreground")}>
          {label}
        </span>
        {compact ? null : <span className="whitespace-nowrap text-muted-foreground">{resetsIn(meter.windowEnd)}</span>}
      </div>
    </div>
  );
}
