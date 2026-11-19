import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, { badge: string; dot: string }> = {
  success: { badge: "bg-success-soft text-success", dot: "bg-success" },
  warning: { badge: "bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { badge: "bg-danger-soft text-danger", dot: "bg-danger" },
  info: { badge: "bg-info-soft text-info", dot: "bg-info" },
  neutral: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
};

const STATUS_TONES: Record<string, Tone> = {
  active: "success",
  enabled: "success",
  approved: "success",
  applied: "success",
  linked: "success",
  provisioning: "warning",
  pending: "warning",
  observe: "warning",
  suspended: "warning",
  failed: "danger",
  rejected: "danger",
  revoked: "danger",
  expired: "neutral",
  disabled: "neutral",
  archived: "neutral",
};

/** The tone a control-plane status reads as; unknown statuses are neutral. */
export function statusTone(status: string): Tone {
  return STATUS_TONES[status.toLowerCase()] ?? "neutral";
}

export function StatusBadge({
  status,
  tone,
  children,
  className,
}: {
  status?: string;
  tone?: Tone;
  children?: ReactNode;
  className?: string;
}) {
  const resolved = TONES[tone ?? statusTone(status ?? "")];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        resolved.badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", resolved.dot)} />
      {children ?? status}
    </span>
  );
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", TONES[tone].dot, className)} />;
}
