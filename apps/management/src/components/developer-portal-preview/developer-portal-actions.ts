import { buildServiceLifecycle } from "@/lib/service-lifecycle";
import type { QuotaPolicy } from "@/lib/schemas";

export type DeveloperPortalAction = {
  id: string;
  label: string;
  source: "Service setup" | "Quota" | "Runbook";
  severity: "critical" | "warning" | "info";
  evidence: string;
  action: {
    label: string;
    href: string;
  };
  priority: number;
};

export function buildDeveloperPortalActions({
  tribeId,
  lifecycleEntries,
  quotaPolicies,
}: {
  tribeId: string;
  lifecycleEntries: ReturnType<typeof buildServiceLifecycle>[];
  quotaPolicies: QuotaPolicy[];
}) {
  const actions: DeveloperPortalAction[] = [
    ...lifecycleEntries
      .filter((entry) => entry.status !== "ready")
      .map((entry) => ({
        id: `lifecycle:${entry.service.serviceId}`,
        label: "Resolve service setup blockers",
        source: "Service setup" as const,
        severity:
          entry.status === "blocked"
            ? ("critical" as const)
            : ("warning" as const),
        evidence: `${entry.service.name || entry.service.serviceId} has ${entry.blockedCount} blocked and ${entry.attentionCount} attention lifecycle checks.`,
        action: {
          label: "Open service detail",
          href: `/tribes/${encodeURIComponent(entry.service.serviceId)}?section=governance`,
        },
        priority: 0,
      })),
  ];

  if (quotaPolicies[0]) {
    actions.push({
      id: "quota:request",
      label: "Quota request",
      source: "Quota",
      severity: "info",
      evidence: `Active quota policy allows ${quotaPolicies[0].maxRequests.toLocaleString()} requests per ${quotaPolicies[0].windowSeconds}s.`,
      action: {
        label: "Request quota increase",
        href: "#developer-portal-quota-request",
      },
      priority: 1,
    });
  } else if (tribeId) {
    actions.push({
      id: "quota:create",
      label: "Create quota policy",
      source: "Quota",
      severity: "warning",
      evidence: "No active quota policy is visible for this tribe.",
      action: {
        label: "Open quota policies",
        href: serviceDetailHref(tribeId, "quotas"),
      },
      priority: 1,
    });
  }

  actions.push({
    id: "runbook:sdk",
    label: "Open SDK runbook",
    source: "Runbook",
    severity: "info",
    evidence: "Use the consumer runbook for SDK setup and request handling.",
    action: {
      label: "Open SDK runbook",
      href: "/docs/consumer-runbook",
    },
    priority: 2,
  });

  return actions.sort(compareDeveloperPortalActions);
}

export function compareDeveloperPortalActions(
  left: DeveloperPortalAction,
  right: DeveloperPortalAction,
) {
  const severityDelta =
    developerPortalSeverityRank(left) - developerPortalSeverityRank(right);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.id.localeCompare(right.id);
}

export function developerPortalSeverityRank(action: DeveloperPortalAction) {
  if (action.severity === "critical") return 0;
  if (action.severity === "warning") return 1;
  return 2;
}

export function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}
