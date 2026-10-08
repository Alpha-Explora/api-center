"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LightbulbIcon } from "lucide-react";
import {
  getConfluentPipelineStatus,
  getTribeSecretStatus,
} from "@/lib/api-center-client";
import { getServiceEventTopics } from "@/lib/event-topics";
import {
  buildRegistryProposedActions,
  buildQuotaProposedActions,
  buildServiceProposedActions,
  type ProposedAction,
} from "@/lib/proposed-actions";
import { queryKeys } from "@/lib/query-keys";
import type {
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DashboardProposedActionsPanel({
  services,
  quotaPolicies = [],
  quotaUsage = [],
}: {
  services: ServiceRegistryEntry[];
  quotaPolicies?: QuotaPolicy[];
  quotaUsage?: QuotaUsageDecision[];
}) {
  return (
    <ProposedActionsPanel
      title="Proposed actions"
      description="Review generated registry fixes before running any write action."
      actions={[
        ...buildRegistryProposedActions(services),
        ...buildQuotaProposedActions({
          services,
          policies: quotaPolicies,
          usage: quotaUsage,
        }),
      ]}
    />
  );
}

export function ServiceProposedActionsPanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const topics = useMemo(
    () =>
      getServiceEventTopics({
        serviceId: service.serviceId,
        ownerTribeId: service.ownerTribeId,
        serviceType: service.serviceType === "shared" ? "shared" : "tribe",
      }),
    [service.serviceId, service.ownerTribeId, service.serviceType],
  );
  const pipelineStatusQuery = useQuery({
    queryKey: queryKeys.confluentPipelineStatus(
      service.serviceId,
      topics.primary,
    ),
    queryFn: () =>
      getConfluentPipelineStatus(service.serviceId, topics.primary),
    retry: 1,
  });
  const secretStatusQuery = useQuery({
    queryKey: queryKeys.tribeSecretStatus(service.serviceId),
    queryFn: () =>
      getTribeSecretStatus(service.serviceId),
    retry: 1,
    enabled: service.serviceType === "tribe",
  });
  const actions = buildServiceProposedActions({
    service,
    pipelineStatus: pipelineStatusQuery.data,
    secretStatus: secretStatusQuery.data,
  });

  return (
    <ProposedActionsPanel
      title="Service proposed actions"
      description="Suggested fixes from manifest, secret, and pipeline state."
      actions={actions}
      loading={pipelineStatusQuery.isLoading || secretStatusQuery.isLoading}
    />
  );
}

export function ProposedActionsPanel({
  title,
  description,
  actions,
  loading,
}: {
  title: string;
  description: string;
  actions: ProposedAction[];
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LightbulbIcon data-icon="inline-start" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <div className="rounded-lg border bg-muted/25 p-3 text-sm text-muted-foreground">
            Checking for proposed actions.
          </div>
        ) : actions.length ? (
          actions.map((action) => (
            <div
              key={action.id}
              className="flex flex-col gap-3 rounded-lg border p-3 text-sm md:flex-row md:items-start md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{action.title}</span>
                  <Badge variant="outline">{action.risk}</Badge>
                  <Badge variant="secondary">{action.execution}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {action.description}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Reason: {action.reason}. Expires:{" "}
                  {new Date(action.expiresAt).toLocaleString()}.
                </div>
              </div>
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={action.href}
              >
                Review
              </Link>
            </div>
          ))
        ) : (
          <div className="rounded-lg border bg-muted/25 p-3 text-sm text-muted-foreground">
            No proposed actions for the currently loaded state.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
