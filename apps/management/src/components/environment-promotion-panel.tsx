"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  EyeIcon,
  RocketIcon,
} from "lucide-react";
import {
  getAuditEvents,
  getConfluentPipelineStatus,
  listQuotaPolicies,
  listRegistrationRequests,
  listServices,
  listTribePlanAssignments,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { displayRuntimeEnvironment } from "@/lib/environment-names";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AuditEvent,
  ConfluentPipelineStatusResponse,
  QuotaPolicy,
  ServiceRegistrationRequest,
  ServiceRegistryEntry,
  TribePlanAssignment,
} from "@/lib/schemas";

type PromotionGateId =
  | "health_check"
  | "smoke_test"
  | "owner_contact"
  | "quota_policy"
  | "plan_tier"
  | "event_topic"
  | "s3_sink"
  | "sdk_handoff"
  | "live_approval";

type PromotionGate = {
  id: PromotionGateId;
  label: string;
  passed: boolean;
  required: boolean;
  evidence: string;
  proposedAction: {
    label: string;
    href: string;
  };
};

type PromotionEvidence = {
  service: ServiceRegistryEntry;
  quotaPolicies: QuotaPolicy[];
  planAssignments: TribePlanAssignment[];
  auditEvents: AuditEvent[];
  approvedRequests: ServiceRegistrationRequest[];
  pipelineStatus?: ConfluentPipelineStatusResponse["data"];
};

export function EnvironmentPromotionPanel({
  initialServiceId = "",
}: {
  initialServiceId?: string;
}) {
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId);
  const [selectedGateId, setSelectedGateId] = useState<PromotionGateId>();
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });
  const services = useMemo(
    () => servicesQuery.data ?? [],
    [servicesQuery.data],
  );
  const effectiveSelectedServiceId =
    selectedServiceId || services[0]?.serviceId || "";
  const selectedService =
    services.find(
      (service) => service.serviceId === effectiveSelectedServiceId,
    ) ?? services[0];
  const ownerTribeId = selectedService
    ? getOwnerTribeId(selectedService)
    : undefined;
  const eventTopic = selectedService
    ? `tribe.${ownerTribeId}.events`
    : undefined;

  const quotaPoliciesQuery = useQuery({
    queryKey: queryKeys.quotaPolicies(ownerTribeId ?? "none"),
    queryFn: () => listQuotaPolicies(ownerTribeId),
    enabled: Boolean(ownerTribeId),
  });
  const planAssignmentsQuery = useQuery({
    queryKey: queryKeys.planAssignments(`${ownerTribeId ?? "none"}:live`),
    queryFn: () =>
      listTribePlanAssignments({
        ownerTribeId,
        environment: "live",
        status: "active",
      }),
    enabled: Boolean(ownerTribeId),
  });
  const auditEventsQuery = useQuery({
    queryKey: queryKeys.auditEvents(selectedService?.serviceId ?? "none"),
    queryFn: () =>
      getAuditEvents({ serviceId: selectedService?.serviceId, limit: 50 }),
    enabled: Boolean(selectedService),
  });
  const approvedRequestsQuery = useQuery({
    queryKey: queryKeys.registrationRequests("approved"),
    queryFn: () => listRegistrationRequests("approved"),
  });
  const pipelineStatusQuery = useQuery({
    queryKey: queryKeys.confluentPipelineStatus(
      selectedService?.serviceId ?? "none",
      eventTopic,
    ),
    queryFn: () =>
      getConfluentPipelineStatus(
        selectedService!.serviceId,
        eventTopic,
        ownerTribeId,
      ),
    enabled: Boolean(selectedService && ownerTribeId && eventTopic),
    retry: false,
  });

  const decision = useMemo(() => {
    if (!selectedService) return null;
    return evaluatePromotionGates({
      service: selectedService,
      quotaPolicies: quotaPoliciesQuery.data ?? [],
      planAssignments: planAssignmentsQuery.data ?? [],
      auditEvents: auditEventsQuery.data ?? [],
      approvedRequests: approvedRequestsQuery.data ?? [],
      pipelineStatus: pipelineStatusQuery.data,
    });
  }, [
    selectedService,
    quotaPoliciesQuery.data,
    planAssignmentsQuery.data,
    auditEventsQuery.data,
    approvedRequestsQuery.data,
    pipelineStatusQuery.data,
  ]);

  if (servicesQuery.isLoading) {
    return <Skeleton className="h-72 w-full" />;
  }

  if (!selectedService || !decision) {
    return (
      <Alert>
        <CircleAlertIcon data-icon="inline-start" />
        <AlertTitle>No registered services</AlertTitle>
        <AlertDescription>
          Register a tribe service before checking live promotion gates.
        </AlertDescription>
      </Alert>
    );
  }

  const blockedGates = decision.gates.filter(
    (gate) => gate.required && !gate.passed,
  );
  const orderedGates = [...decision.gates].sort(comparePromotionGates);
  const selectedGate =
    orderedGates.find((gate) => gate.id === selectedGateId) ?? orderedGates[0];

  return (
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <RocketIcon data-icon="inline-start" />
            Live promotion gates
          </CardTitle>
          <CardDescription>
            Required evidence for test-to-live rollout of a registered service.
          </CardDescription>
        </div>
        <label className="flex min-w-60 flex-col gap-1 text-sm font-medium">
          Service
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={effectiveSelectedServiceId}
            onChange={(event) => setSelectedServiceId(event.target.value)}
          >
            {services.map((service) => (
              <option key={service.serviceId} value={service.serviceId}>
                {service.serviceId}
              </option>
            ))}
          </select>
        </label>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Alert
          className={
            decision.canPromote
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }
        >
          {decision.canPromote ? (
            <CheckCircle2Icon data-icon="inline-start" />
          ) : (
            <AlertTriangleIcon data-icon="inline-start" />
          )}
          <AlertTitle>
            {decision.canPromote
              ? "Ready for live approval"
              : "Blocked from live"}
          </AlertTitle>
          <AlertDescription>
            {decision.canPromote
              ? `${selectedService.serviceId} has all required promotion evidence.`
              : `${blockedGates.length} required gate${blockedGates.length === 1 ? "" : "s"} still need evidence.`}
          </AlertDescription>
        </Alert>

        <PromotionServiceContext
          ownerTribeId={getOwnerTribeId(selectedService)}
          service={selectedService}
        />

        <div className="grid gap-3 lg:grid-cols-3">
          <Signal
            label="Service"
            value={selectedService.name || selectedService.serviceId}
          />
          <Signal
            label="Owner tribe"
            value={getOwnerTribeId(selectedService)}
          />
          <Signal
            label="Target topic"
            value={
              requiresEventExport(selectedService)
                ? eventTopic!
                : "not required"
            }
          />
          <Signal
            label="Pipeline status"
            value={
              pipelineStatusQuery.isError
                ? "unavailable"
                : pipelineStatusQuery.isFetching
                  ? "checking"
                  : "checked"
            }
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(21rem,0.75fr)]">
          <div className="overflow-hidden rounded-lg border">
            <div className="hidden grid-cols-[minmax(9rem,0.75fr)_6rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>Gate</span>
              <span>Status</span>
              <span>Evidence</span>
              <span className="sr-only">Inspect</span>
            </div>
            <div className="divide-y">
              {orderedGates.map((gate) => (
                <GateRow
                  key={gate.id}
                  gate={gate}
                  selected={selectedGate?.id === gate.id}
                  onSelect={() => setSelectedGateId(gate.id)}
                />
              ))}
            </div>
          </div>

          {selectedGate ? <PromotionGateDetail gate={selectedGate} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PromotionServiceContext({
  ownerTribeId,
  service,
}: {
  ownerTribeId: string;
  service: ServiceRegistryEntry;
}) {
  const links = [
    {
      label: "Service detail",
      href: `/tribes/${encodeURIComponent(service.serviceId)}?section=summary`,
      action: "Open service detail",
    },
    {
      label: "Audit trail",
      href: serviceDetailHref(service.serviceId, "evidence"),
      action: "Open audit trail",
    },
    {
      label: "Portal preview",
      href: `/developer-portal?tribeId=${encodeURIComponent(ownerTribeId)}`,
      action: "Open portal preview",
    },
    {
      label: "Quota workspace",
      href: serviceDetailHref(service.serviceId, "quotas"),
      action: "Open quota workspace",
    },
  ];

  return (
    <section
      aria-label="Promotion service context"
      className="rounded-lg border bg-muted/10 p-3"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {service.name || service.serviceId}
          </div>
          <div className="mt-1 break-words font-mono text-xs text-muted-foreground">
            {service.serviceId} / {ownerTribeId}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((link) => (
            <Link
              key={link.label}
              aria-label={link.action}
              href={link.href}
              className="rounded-md border bg-background px-3 py-2 text-xs font-medium underline-offset-4 hover:bg-muted hover:underline"
            >
              <span className="block text-muted-foreground">{link.label}</span>
              <span className="mt-0.5 block">{link.action}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function evaluatePromotionGates(evidence: PromotionEvidence) {
  const service = evidence.service;
  const eventTopicRequired = requiresEventExport(service);
  const s3ExportRequired = eventTopicRequired;
  const gates: PromotionGate[] = [
    {
      id: "health_check",
      label: "Health check",
      passed: service.healthy === true,
      required: true,
      evidence:
        service.healthy === true
          ? `Passed${service.lastHealthCheckAt ? ` at ${service.lastHealthCheckAt}` : ""}.`
          : "No passing health check evidence.",
      proposedAction: {
        label: "Run Check health from the service detail page.",
        href: serviceDetailHref(service.serviceId, "actions"),
      },
    },
    {
      id: "smoke_test",
      label: "Smoke test",
      passed: hasAuditEvidence(
        evidence.auditEvents,
        ["smoke"],
        service.serviceId,
      ),
      required: true,
      evidence: hasAuditEvidence(
        evidence.auditEvents,
        ["smoke"],
        service.serviceId,
      )
        ? "Smoke evidence found in audit events."
        : "No passing smoke test evidence.",
      proposedAction: {
        label: "Run safe shared-service smoke checks with a tribe token.",
        href: serviceDetailHref(service.serviceId, "actions"),
      },
    },
    {
      id: "owner_contact",
      label: "Owner and contact",
      passed: Boolean(service.ownerTeam?.trim() && service.contact?.trim()),
      required: true,
      evidence:
        service.ownerTeam?.trim() && service.contact?.trim()
          ? `${service.ownerTeam} / ${service.contact}`
          : "Owner team or contact is missing.",
      proposedAction: {
        label: "Update ownerTeam and contact in the service manifest.",
        href: `/tribes/${encodeURIComponent(service.serviceId)}/edit`,
      },
    },
    {
      id: "quota_policy",
      label: "Quota policy",
      passed: evidence.quotaPolicies.some(
        (policy) =>
          policy.status === "active" &&
          (policy.mode === "observe" || policy.mode === "enforce"),
      ),
      required: true,
      evidence:
        evidence.quotaPolicies.length > 0
          ? `${evidence.quotaPolicies.length} quota policy record(s) found.`
          : "No active observe/enforce quota policy.",
      proposedAction: {
        label: "Create an observe-mode quota policy for the tribe.",
        href: serviceDetailHref(service.serviceId, "quotas"),
      },
    },
    {
      id: "plan_tier",
      label: "Plan tier",
      passed: evidence.planAssignments.some(
        (assignment) =>
          assignment.status === "active" &&
          displayRuntimeEnvironment(assignment.environment) === "live",
      ),
      required: true,
      evidence:
        evidence.planAssignments.length > 0
          ? `${evidence.planAssignments[0]?.planKey ?? "unknown"} plan assigned.`
          : "No active live plan assignment.",
      proposedAction: {
        label: "Assign a plan tier for the live environment.",
        href: "/plans",
      },
    },
    {
      id: "event_topic",
      label: "Event topic",
      passed:
        !eventTopicRequired || evidence.pipelineStatus?.topicExists === true,
      required: eventTopicRequired,
      evidence: !eventTopicRequired
        ? "Not required for this service."
        : evidence.pipelineStatus?.topicExists
          ? `${evidence.pipelineStatus.topicName} exists.`
          : "Required event topic is missing.",
      proposedAction: {
        label: "Provision the tribe event topic from onboarding.",
        href: serviceDetailHref(service.serviceId, "pipeline"),
      },
    },
    {
      id: "s3_sink",
      label: "S3 sink inclusion",
      passed:
        !s3ExportRequired ||
        evidence.pipelineStatus?.s3SinkIncludesTopic === true,
      required: s3ExportRequired,
      evidence: !s3ExportRequired
        ? "Not required for this service."
        : evidence.pipelineStatus?.s3SinkIncludesTopic
          ? "Topic is included in the managed S3 Sink."
          : "Required topic is not included in the S3 Sink.",
      proposedAction: {
        label: "Add the topic to the managed Confluent S3 Sink.",
        href: serviceDetailHref(service.serviceId, "pipeline"),
      },
    },
    {
      id: "sdk_handoff",
      label: "SDK handoff packet",
      passed:
        Boolean(service.contact?.trim() && service.requiredScopes.length > 0) ||
        hasAuditEvidence(evidence.auditEvents, ["handoff"], service.serviceId),
      required: true,
      evidence:
        service.contact?.trim() && service.requiredScopes.length > 0
          ? "Handoff packet can be generated from manifest metadata."
          : "SDK handoff packet evidence is missing.",
      proposedAction: {
        label: "Generate and send the tribe handoff packet.",
        href: serviceDetailHref(service.serviceId, "governance"),
      },
    },
    {
      id: "live_approval",
      label: "Live approval",
      passed:
        evidence.approvedRequests.some(
          (request) =>
            request.serviceId === service.serviceId ||
            request.ownerTribeId === getOwnerTribeId(service),
        ) ||
        hasAuditEvidence(
          evidence.auditEvents,
          ["approval", "live"],
          service.serviceId,
        ),
      required: true,
      evidence:
        evidence.approvedRequests.length > 0
          ? "Approved registration request evidence exists."
          : "No approved live registration request evidence.",
      proposedAction: {
        label: "Create and approve a live registration request.",
        href: serviceDetailHref(service.serviceId, "governance"),
      },
    },
  ];

  const blockedGateCount = gates.filter(
    (gate) => gate.required && !gate.passed,
  ).length;

  return {
    canPromote: blockedGateCount === 0,
    blockedGateCount,
    gates,
  };
}

function GateRow({
  gate,
  selected,
  onSelect,
}: {
  gate: PromotionGate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(9rem,0.75fr)_6rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="flex items-center gap-2">
        <span className="font-medium">{gate.label}</span>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={gate.passed ? "secondary" : "destructive"}>
          {promotionGateStatus(gate)}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {gate.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect promotion gate ${gate.label}`}
        title={`Inspect promotion gate ${gate.label}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function PromotionGateDetail({ gate }: { gate: PromotionGate }) {
  return (
    <aside
      aria-label="Selected promotion gate detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Selected gate</div>
          <div className="mt-1 text-base font-medium">{gate.label}</div>
        </div>
        <Badge variant={gate.passed ? "secondary" : "destructive"}>
          {promotionGateStatus(gate)}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Evidence
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{gate.evidence}</p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        {gate.passed ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No action needed.
          </p>
        ) : (
          <Link
            href={gate.proposedAction.href}
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            {gate.proposedAction.label}
            <RocketIcon data-icon="inline-end" />
          </Link>
        )}
      </div>
    </aside>
  );
}

function comparePromotionGates(left: PromotionGate, right: PromotionGate) {
  const rankDelta = promotionGateRank(left) - promotionGateRank(right);
  if (rankDelta !== 0) return rankDelta;
  return 0;
}

function promotionGateRank(gate: PromotionGate) {
  if (gate.required && !gate.passed) return 0;
  if (!gate.required && !gate.passed) return 1;
  return 2;
}

function promotionGateStatus(gate: PromotionGate) {
  if (gate.passed) return "pass";
  return gate.required ? "blocked" : "optional";
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}

function getOwnerTribeId(service: ServiceRegistryEntry) {
  return service.ownerTribeId || service.serviceId;
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${section}`;
}

function requiresEventExport(service: ServiceRegistryEntry) {
  return (
    service.requiredScopes.includes("external:kafka:write") ||
    service.consumes.includes("kafka")
  );
}

function hasAuditEvidence(
  events: AuditEvent[],
  terms: string[],
  serviceId: string,
) {
  return events.some((event) => {
    if (event.severity === "error") return false;
    const searchable = `${event.type} ${event.message}`.toLowerCase();
    const appliesToService =
      !event.serviceId ||
      event.serviceId === serviceId ||
      event.tribeServiceId === serviceId;
    return appliesToService && terms.every((term) => searchable.includes(term));
  });
}
