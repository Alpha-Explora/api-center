import type { ReactNode } from "react";
import { AlertTriangleIcon, InfoIcon } from "lucide-react";
import { ApiError } from "@/lib/api-center/client-core";
import { cn } from "@/lib/utils";

/** An inline failure with the gateway's message and error code; never hidden behind an empty state. */
export function ErrorPanel({
  error,
  title = "Something went wrong",
  className,
  action,
}: {
  error: unknown;
  title?: string;
  className?: string;
  action?: ReactNode;
}) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiError ? (error.code ?? `HTTP ${error.status}`) : undefined;
  return (
    <div role="alert" className={cn("flex gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px]", className)}>
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-0.5 break-words text-muted-foreground">{message}</p>
        {code ? <p className="mt-1 font-mono text-xs text-muted-foreground">{code}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A quiet notice for a limitation, a rule or a next step. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: "info" | "warning";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const Icon = tone === "warning" ? AlertTriangleIcon : InfoIcon;
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border px-4 py-3 text-[13px]",
        tone === "warning" ? "border-warning/30 bg-warning-soft" : "border-border bg-muted/50",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className={cn("text-muted-foreground", title ? "mt-0.5" : undefined)}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
