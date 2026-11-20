"use client";

import { useContext, useState, type ReactNode } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { AlertTriangleIcon, InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-center/client-core";
import { isTransientError } from "@/lib/api-center/retry-policy";
import { cn } from "@/lib/utils";

const TRANSIENT_MESSAGE = "APICenter is busy or starting up. This usually clears in a few seconds.";

/**
 * An inline failure; never hidden behind an empty state. A failure that may clear by itself (busy,
 * restarting, offline) reads as such and offers Try again, which refetches every failed query on the
 * page. The gateway's code stays available under Details for support.
 */
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
  const queryClient = useContext(QueryClientContext);
  const [retrying, setRetrying] = useState(false);
  const transient = isTransientError(error);
  const message = transient ? TRANSIENT_MESSAGE : error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiError ? (error.code ?? `HTTP ${error.status}`) : undefined;
  const retry =
    transient && queryClient && !action ? (
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 self-start"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void queryClient
            .refetchQueries({ type: "active", predicate: (query) => query.state.status === "error" })
            .finally(() => setRetrying(false));
        }}
      >
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    ) : null;
  return (
    <div role="alert" className={cn("flex gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px]", className)}>
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-0.5 break-words text-muted-foreground">{message}</p>
        {code ? (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Details</summary>
            <p className="mt-1 font-mono">{code}</p>
            {transient && error instanceof Error ? <p className="mt-0.5 break-words">{error.message}</p> : null}
          </details>
        ) : null}
      </div>
      {action ?? retry}
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
