"use client";

import type { SharedServiceUsageWindow } from "@/lib/schemas";
import { usageWindows } from "@/lib/usage-windows";
import { cn } from "@/lib/utils";

export function TimeWindowSelector({
  value,
  onChange,
  ariaLabel = "Select time window",
}: {
  value: SharedServiceUsageWindow;
  onChange: (value: SharedServiceUsageWindow) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="flex rounded-full border bg-background p-1"
      aria-label={ariaLabel}
    >
      {usageWindows.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "h-8 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors",
            value === option && "bg-primary text-primary-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
