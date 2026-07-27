"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeIcon, ShieldCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type RunbookAction = {
  id: string;
  label: string;
  source: "Portal packet" | "SDK setup" | "Access" | "Readiness";
  severity: "critical" | "warning" | "info";
  evidence: string;
  action: {
    label: string;
    href: string;
  };
  priority: number;
};

const runbookActions = (
  [
  {
    id: "portal-packet",
    label: "Verify portal packet",
    source: "Portal packet",
    severity: "critical",
    evidence:
      "Confirm endpoint, tribe service ID, allowed services, quota policy, and event topic prefix before live traffic.",
    action: {
      label: "Open developer portal",
      href: "/developer-portal",
    },
    priority: 0,
  },
  {
    id: "sdk-credentials",
    label: "Configure SDK credentials",
    source: "SDK setup",
    severity: "warning",
    evidence:
      "Install the SDK server-side and keep runtime credentials out of browser bundles.",
    action: {
      label: "Open manifest tools",
      href: "/manifest-tools",
    },
    priority: 1,
  },
  {
    id: "service-access",
    label: "Confirm service access",
    source: "Access",
    severity: "warning",
    evidence:
      "Use only the allowed services and scopes from the portal packet before requesting more access.",
    action: {
      label: "Open marketplace",
      href: "/marketplace",
    },
    priority: 2,
  },
  {
    id: "readiness-smoke-test",
    label: "Run readiness smoke test",
    source: "Readiness",
    severity: "info",
    evidence:
      "Validate the service path before moving the packet into live readiness review.",
    action: {
      label: "Open smoke tests",
      href: "/smoke-tests",
    },
    priority: 3,
  },
  ] satisfies RunbookAction[]
).sort(compareRunbookActions);

export function ConsumerRunbookActions() {
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const selectedAction =
    runbookActions.find((action) => action.id === selectedActionId) ??
    runbookActions[0];

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Action</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {runbookActions.map((action) => (
            <RunbookActionRow
              key={action.id}
              action={action}
              selected={action.id === selectedAction.id}
              onSelect={() => setSelectedActionId(action.id)}
            />
          ))}
        </div>
      </div>
      <RunbookActionDetail action={selectedAction} />
    </section>
  );
}

function RunbookActionRow({
  action,
  selected,
  onSelect,
}: {
  action: RunbookAction;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{action.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {action.source}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {action.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect runbook action ${action.label}`}
        title={`Inspect runbook action ${action.label}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function RunbookActionDetail({ action }: { action: RunbookAction }) {
  return (
    <aside
      aria-label="Selected runbook action detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Recommended setup step</div>
          <div className="mt-1 truncate text-base font-medium">
            {action.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {action.source}
          </div>
        </div>
        <Badge variant={action.severity === "info" ? "secondary" : "destructive"}>
          {action.severity}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {action.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={action.action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {action.action.label}
          <ShieldCheckIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function compareRunbookActions(left: RunbookAction, right: RunbookAction) {
  const severityDelta = severityRank(left) - severityRank(right);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.id.localeCompare(right.id);
}

function severityRank(action: RunbookAction) {
  if (action.severity === "critical") return 0;
  if (action.severity === "warning") return 1;
  return 2;
}
