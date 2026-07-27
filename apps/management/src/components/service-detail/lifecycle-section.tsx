import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Detail } from "@/components/service-detail/detail";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ServiceRegistryEntry } from "@/lib/schemas";
import type {
  ServiceLifecycleEntry,
  ServiceLifecycleStage,
  ServiceLifecycleStageStatus,
  ServiceLifecycleStatus,
} from "@/lib/service-lifecycle";

export function ServiceLifecycleCommandMap({
  entry,
}: {
  entry: ServiceLifecycleEntry;
}) {
  return (
    <Card aria-label="Service lifecycle command map">
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Lifecycle command map</CardTitle>
          <CardDescription>
            Source-backed or registry-derived readiness for the current service
            across registry, runtime, quotas, pipeline, promotion, and evidence.
          </CardDescription>
        </div>
        <Badge variant={lifecycleStatusVariant(entry.status)}>
          {entry.status}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Next action
          </div>
          <Link
            href={lifecycleActionHref(
              entry.service.serviceId,
              entry.nextAction.stageId,
              entry.nextAction.href,
            )}
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            Open next action
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            {entry.nextAction.label}
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[9rem_8rem_minmax(0,1fr)_10rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Stage</span>
            <span>Status</span>
            <span>Evidence</span>
            <span>Source</span>
          </div>
          <div className="divide-y">
            {entry.stages.map((stage) => (
              <div
                key={stage.id}
                className="grid gap-2 px-3 py-3 md:grid-cols-[9rem_8rem_minmax(0,1fr)_10rem] md:items-start"
              >
                <div className="font-medium">{stage.label}</div>
                <div>
                  <Badge variant={lifecycleStageVariant(stage.status)}>
                    {stage.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {stage.evidence}
                  </p>
                  <Link
                    href={serviceLifecycleStageHref(
                      entry.service.serviceId,
                      stage,
                    )}
                    className="mt-2 inline-flex text-xs font-medium underline-offset-4 hover:underline"
                  >
                    {stage.action}
                  </Link>
                </div>
                <div className="break-words font-mono text-xs text-muted-foreground">
                  {stage.source ?? "derived"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function LifecycleEvidenceRouteMap({
  entry,
}: {
  entry: ServiceLifecycleEntry;
}) {
  return (
    <Card aria-label="Lifecycle evidence route map">
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Lifecycle evidence routes</CardTitle>
          <CardDescription>
            Stage evidence with direct routes to the service detail section that
            can resolve or verify it.
          </CardDescription>
        </div>
        <Badge variant={lifecycleStatusVariant(entry.status)}>
          {entry.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[9rem_8rem_minmax(0,1fr)_10rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Stage</span>
            <span>Status</span>
            <span>Evidence route</span>
            <span>Source</span>
          </div>
          <div className="divide-y">
            {entry.stages.map((stage) => (
              <div
                key={stage.id}
                className="grid gap-2 px-3 py-3 md:grid-cols-[9rem_8rem_minmax(0,1fr)_10rem] md:items-start"
              >
                <div className="font-medium">{stage.label}</div>
                <div>
                  <Badge variant={lifecycleStageVariant(stage.status)}>
                    {stage.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {stage.evidence}
                  </p>
                  <Link
                    href={serviceLifecycleStageHref(
                      entry.service.serviceId,
                      stage,
                    )}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                  >
                    Open {stage.label} section
                    <ArrowRightIcon data-icon="inline-end" />
                  </Link>
                </div>
                <div className="break-words font-mono text-xs text-muted-foreground">
                  {stage.source ?? "derived"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function GovernancePostureCard({
  service,
  lifecycleEntry,
}: {
  service: ServiceRegistryEntry;
  lifecycleEntry?: ServiceLifecycleEntry;
}) {
  const promotionStage = lifecycleEntry?.stages.find(
    (stage) => stage.id === "promotion",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance review</CardTitle>
        <CardDescription>
          Ownership and promotion inputs that determine whether a service is
          ready for broader use.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm md:grid-cols-3">
          <Detail label="Owner team" value={service.ownerTeam ?? "Not set"} />
          <Detail label="Contact" value={service.contact ?? "Not set"} />
          <Detail label="Version" value={service.version} />
        </dl>
        <div className="mt-4 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Promotion readiness</div>
            {promotionStage ? (
              <Badge variant={lifecycleStageVariant(promotionStage.status)}>
                {promotionStage.status}
              </Badge>
            ) : null}
          </div>
          {promotionStage ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {promotionStage.evidence}
              </p>
              <p className="text-sm font-medium">{promotionStage.action}</p>
              <div className="break-words font-mono text-xs text-muted-foreground">
                {promotionStage.source ?? "derived"}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Promotion readiness evidence has not been generated for this
              service yet.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function lifecycleStatusVariant(status: ServiceLifecycleStatus) {
  if (status === "blocked") return "destructive";
  if (status === "attention") return "outline";
  return "secondary";
}

function lifecycleStageVariant(status: ServiceLifecycleStageStatus) {
  if (status === "blocked") return "destructive";
  if (status === "complete") return "secondary";
  return "outline";
}

function serviceLifecycleStageHref(
  serviceId: string,
  stage: ServiceLifecycleStage,
) {
  return lifecycleActionHref(serviceId, stage.id, stage.href);
}

function lifecycleActionHref(
  serviceId: string,
  stageId: string,
  fallbackHref: string,
) {
  if (stageId === "promotion" && fallbackHref === "/promotions") {
    return `/tribes/${encodeURIComponent(serviceId)}?section=governance`;
  }

  if (stageId === "quotas" && fallbackHref.startsWith("/quotas")) {
    return `/tribes/${encodeURIComponent(serviceId)}?section=quotas`;
  }

  return fallbackHref;
}
