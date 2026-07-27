"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, EyeIcon } from "lucide-react";
import {
  buildPlatformLifecycle,
  type PlatformLifecycle,
  type ServiceLifecycleEntry,
  type ServiceLifecycleStage,
  type ServiceLifecycleStageStatus,
  type ServiceLifecycleStatus,
} from "@/lib/service-lifecycle";
import type {
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function PlatformLifecyclePanel({
  lifecycle: sourceLifecycle,
  services = [],
  quotaPolicies = [],
  quotaUsage = [],
  limit,
}: {
  lifecycle?: PlatformLifecycle;
  services?: ServiceRegistryEntry[];
  quotaPolicies?: QuotaPolicy[];
  quotaUsage?: QuotaUsageDecision[];
  limit?: number;
}) {
  const lifecycle =
    sourceLifecycle ??
    buildPlatformLifecycle({
      services,
      quotaPolicies,
      quotaUsage,
    });
  const entries = limit
    ? lifecycle.entries.slice(0, limit)
    : lifecycle.entries;
  const showDetail = !limit && entries.length > 0;
  const [selectedServiceId, setSelectedServiceId] = useState<string>();
  const selectedEntry = showDetail
    ? entries.find((entry) => entry.service.serviceId === selectedServiceId) ??
      entries[0]
    : undefined;

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Service lifecycle</CardTitle>
          <CardDescription>
            One spine for registry, runtime, quotas, pipeline, promotion, and
            evidence readiness.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={lifecycle.summary.blocked ? "destructive" : "outline"}>
            {lifecycle.summary.blocked} blocked
          </Badge>
          <Badge variant="outline">{lifecycle.summary.attention} attention</Badge>
          <Badge variant="secondary">{lifecycle.summary.ready} ready</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
            <div className="overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-[minmax(12rem,0.9fr)_7rem_minmax(14rem,1.4fr)_minmax(14rem,1fr)] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
                <span>Service</span>
                <span>Status</span>
                <span>Lifecycle stages</span>
                <span>Next action</span>
              </div>
              <div className="divide-y">
                {entries.map((entry) => {
                  const isSelected =
                    selectedEntry?.service.serviceId === entry.service.serviceId;

                  return (
                    <div
                      key={entry.service.serviceId}
                      className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(12rem,0.9fr)_7rem_minmax(14rem,1.4fr)_minmax(14rem,1fr)] md:items-start"
                    >
                      <div className="min-w-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                          <Link
                            href={serviceGovernanceHref(entry.service.serviceId)}
                            className="truncate font-medium underline-offset-4 hover:underline"
                          >
                            {entry.service.name || entry.service.serviceId}
                          </Link>
                          {showDetail ? (
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              aria-label={`Inspect lifecycle for ${
                                entry.service.name || entry.service.serviceId
                              }`}
                              title={`Inspect lifecycle for ${
                                entry.service.name || entry.service.serviceId
                              }`}
                              onClick={() =>
                                setSelectedServiceId(entry.service.serviceId)
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground"
                            >
                              <EyeIcon data-icon="inline-end" />
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {entry.service.serviceId}
                        </div>
                      </div>
                      <div>
                        <Badge variant={statusVariant(entry.status)}>
                          {entry.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.stages.map((stage) => (
                          <Badge
                            key={stage.id}
                            title={
                              stage.source
                                ? `${stage.source}: ${stage.evidence}`
                                : stage.evidence
                            }
                            variant={stageVariant(stage.status)}
                            className={
                              stage.status === "not-required"
                                ? "text-muted-foreground"
                                : undefined
                            }
                          >
                            {stage.label}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-sm">
                        <Link
                          href={lifecycleActionHref(
                            entry.service.serviceId,
                            entry.nextAction.stageId,
                            entry.nextAction.href,
                          )}
                          className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                        >
                          {entry.nextAction.label}
                          <ArrowRightIcon data-icon="inline-end" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {selectedEntry ? <LifecycleDetail entry={selectedEntry} /> : null}
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="font-medium">No services registered</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Register a service before lifecycle readiness can be evaluated.
            </p>
          </div>
        )}
        {limit ? (
          <Link
            href="/lifecycle"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            Open full lifecycle
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LifecycleDetail({ entry }: { entry: ServiceLifecycleEntry }) {
  const commandGroups = buildLifecycleCommandGroups(entry.stages);

  return (
    <aside
      aria-label="Selected service lifecycle detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected service</div>
          <Link
            href={serviceGovernanceHref(entry.service.serviceId)}
            className="mt-1 block truncate text-base font-medium underline-offset-4 hover:underline"
          >
            {entry.service.name || entry.service.serviceId}
          </Link>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {entry.service.serviceId}
          </div>
        </div>
        <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={lifecycleActionHref(
            entry.service.serviceId,
            entry.nextAction.stageId,
            entry.nextAction.href,
          )}
          aria-label={`Open next action: ${entry.nextAction.label}`}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Open next action
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Command map
        </div>
        <div className="mt-3 flex flex-col gap-4">
          {commandGroups.map((group) => (
            <section key={group.label} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{group.label}</div>
                <Badge variant="outline">{group.stages.length}</Badge>
              </div>
              <div className="rounded-md border">
                {group.stages.map((stage) => (
                  <div
                    key={stage.id}
                    className="border-b p-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{stage.label}</div>
                      <Badge variant={stageVariant(stage.status)}>
                        {stage.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {stage.evidence}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-muted-foreground">
                        {stage.source ?? "derived"}
                      </span>
                      <Link
                        href={lifecycleActionHref(
                          entry.service.serviceId,
                          stage.id,
                          stage.href,
                        )}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {stage.action}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}

function buildLifecycleCommandGroups(stages: ServiceLifecycleStage[]) {
  const groups = [
    {
      label: "Fix now",
      stages: stages.filter((stage) => stage.status === "blocked"),
    },
    {
      label: "Review next",
      stages: stages.filter((stage) => stage.status === "attention"),
    },
    {
      label: "Evidence ready",
      stages: stages.filter((stage) => stage.status === "complete"),
    },
    {
      label: "Not required",
      stages: stages.filter((stage) => stage.status === "not-required"),
    },
  ];

  return groups.filter((group) => group.stages.length > 0);
}

function statusVariant(status: ServiceLifecycleStatus) {
  if (status === "blocked") return "destructive";
  if (status === "attention") return "outline";
  return "secondary";
}

function stageVariant(status: ServiceLifecycleStageStatus) {
  if (status === "blocked") return "destructive";
  if (status === "complete") return "secondary";
  return "outline";
}

function serviceGovernanceHref(serviceId: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=governance`;
}

function lifecycleActionHref(
  serviceId: string,
  stageId: string,
  fallbackHref: string,
) {
  if (stageId === "promotion" && fallbackHref === "/promotions") {
    return serviceGovernanceHref(serviceId);
  }

  if (stageId === "quotas" && fallbackHref.startsWith("/quotas")) {
    return `/tribes/${encodeURIComponent(serviceId)}?section=quotas`;
  }

  return fallbackHref;
}
