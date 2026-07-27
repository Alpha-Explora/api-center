import { CheckCircleIcon, CircleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ActionReadinessItem = {
  label: string;
  ready: boolean;
  readyText?: string;
  pendingText?: string;
  detail?: string;
};

export function ActionReadiness({
  title,
  items,
}: {
  title: string;
  items: ActionReadinessItem[];
}) {
  return (
    <section
      aria-label={title}
      aria-live="polite"
      role="status"
      className="rounded-lg border bg-muted/15 p-3"
    >
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-2 grid gap-2 text-sm">
        {items.map((item) => {
          const statusText = item.ready
            ? (item.readyText ?? "Ready")
            : (item.pendingText ?? "Required");

          return (
            <li key={item.label} className="flex items-start gap-2">
              {item.ready ? (
                <CheckCircleIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-[var(--brand-green-deep)]"
                />
              ) : (
                <CircleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-foreground">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      item.ready
                        ? "text-[var(--brand-green-deep)]"
                        : "text-muted-foreground",
                    )}
                  >
                    {statusText}
                  </span>
                  <span className="sr-only">
                    {item.label}: {statusText}
                  </span>
                </div>
                {item.detail ? (
                  <div className="mt-0.5 text-muted-foreground">
                    {item.detail}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
