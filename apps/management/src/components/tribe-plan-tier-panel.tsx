"use client";

import { useMemo, useState } from "react";
import { RefreshCwIcon, SaveIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignTribePlan,
  listTribePlanAssignments,
  listTribePlanDefinitions,
  listTribes,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type {
  TribePlanAssignment,
  TribePlanDefinition,
  TribePlanKey,
} from "@/lib/schemas";
import {
  displayRuntimeEnvironment,
  type RuntimeEnvironment,
} from "@/lib/environment-names";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const planKeys: TribePlanKey[] = ["starter", "standard", "pro", "enterprise"];
const environments: RuntimeEnvironment[] = ["test", "live"];

type AssignmentFormState = {
  /** Plans attach to a project; the gateway derives the tribe. */
  projectId: string;
  planKey: TribePlanKey;
  environment: RuntimeEnvironment;
  reason: string;
};

export function TribePlanTierPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AssignmentFormState>({
    projectId: "",
    planKey: "starter",
    environment: "test",
    reason: "",
  });

  const tribesQuery = useQuery({
    queryKey: queryKeys.tenancyTribes,
    queryFn: listTribes,
  });
  const definitionsQuery = useQuery({
    queryKey: queryKeys.planDefinitions,
    queryFn: listTribePlanDefinitions,
  });
  const assignmentsQuery = useQuery({
    queryKey: queryKeys.planAssignments("active"),
    queryFn: () => listTribePlanAssignments({ status: "active" }),
  });
  const assignMutation = useMutation({
    mutationFn: (input: Parameters<typeof assignTribePlan>[0]) =>
      assignTribePlan(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  const assignmentsByPlan = useMemo(
    () => groupAssignmentsByPlan(assignmentsQuery.data ?? []),
    [assignmentsQuery.data],
  );

  function updateField<K extends keyof AssignmentFormState>(
    key: K,
    value: AssignmentFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    assignMutation.mutate({
      projectId: form.projectId,
      planKey: form.planKey,
      environment: form.environment,
      reason: form.reason,
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(20rem,28rem)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Assign project plan</CardTitle>
          <CardDescription>
            Plans attach to one project in one environment. Plan limits apply in
            enforce mode; project quota overrides take precedence for their
            scope.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="plan-project-id">Project</FieldLabel>
                <select
                  id="plan-project-id"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={form.projectId}
                  onChange={(event) =>
                    updateField("projectId", event.target.value)
                  }
                  required
                >
                  <option value="">Choose a project</option>
                  {(tribesQuery.data ?? []).map((tribe) => (
                    <optgroup
                      key={tribe.tribeId}
                      label={`${tribe.name} (${tribe.tribeId})`}
                    >
                      {tribe.projects.map((project) => (
                        <option
                          key={project.projectId}
                          value={project.projectId}
                        >
                          {project.name} ({project.projectId})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="plan-key">Plan</FieldLabel>
                  <select
                    id="plan-key"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={form.planKey}
                    onChange={(event) =>
                      updateField("planKey", event.target.value as TribePlanKey)
                    }
                  >
                    {planKeys.map((planKey) => (
                      <option key={planKey} value={planKey}>
                        {formatLabel(planKey)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="plan-environment">
                    Environment
                  </FieldLabel>
                  <select
                    id="plan-environment"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={form.environment}
                    onChange={(event) =>
                      updateField(
                        "environment",
                        event.target.value as RuntimeEnvironment,
                      )
                    }
                  >
                    {environments.map((environment) => (
                      <option key={environment} value={environment}>
                        {environment}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="plan-reason">Assignment reason</FieldLabel>
                <Textarea
                  id="plan-reason"
                  value={form.reason}
                  onChange={(event) =>
                    updateField("reason", event.target.value)
                  }
                  required
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={assignMutation.isPending}>
                <SaveIcon data-icon="inline-start" />
                Assign plan
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  definitionsQuery.refetch();
                  assignmentsQuery.refetch();
                }}
                disabled={
                  definitionsQuery.isFetching || assignmentsQuery.isFetching
                }
              >
                <RefreshCwIcon data-icon="inline-start" />
                Refresh
              </Button>
            </div>
            {assignMutation.isError ? (
              <p className="text-sm text-destructive">
                {assignMutation.error.message}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <PlanDefinitions
        definitions={definitionsQuery.data ?? []}
        assignmentsByPlan={assignmentsByPlan}
        isLoading={definitionsQuery.isLoading || assignmentsQuery.isLoading}
        isError={definitionsQuery.isError || assignmentsQuery.isError}
      />
    </div>
  );
}

function PlanDefinitions({
  definitions,
  assignmentsByPlan,
  isLoading,
  isError,
}: {
  definitions: TribePlanDefinition[];
  assignmentsByPlan: Map<TribePlanKey, TribePlanAssignment[]>;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <Skeleton className="h-[32rem] rounded-xl" />;
  if (isError) {
    return (
      <ActionFailedState
        title="Could not load plan tiers"
        description="Check API Center admin credentials and the plan entitlement controller."
        recoverySteps={[
          {
            label: "Check plan entitlement controller",
            description:
              "Plan tiers must load before assignments can be trusted.",
          },
          {
            label: "Verify management credentials",
            description:
              "Confirm the management app can read plan definitions.",
          },
        ]}
      />
    );
  }
  if (!definitions.length) {
    return (
      <EmptyDataState
        title="No plan tiers configured"
        description="API Center did not return any tribe plan definitions."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {definitions.map((definition) => (
        <Card key={definition.planKey}>
          <CardHeader className="gap-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{definition.displayName}</CardTitle>
                <CardDescription>
                  {formatQuota(definition.gatewayCallsPerDay, "gateway calls")}
                  {" / "}
                  {formatQuota(
                    definition.kafkaPublishesPerDay,
                    "Kafka publishes",
                  )}
                </CardDescription>
              </div>
              <Badge variant="secondary">{definition.supportTier}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-2 text-sm">
              <PlanDetail label="Retention" value={definition.retentionTier} />
              <PlanDetail
                label="Shared services"
                value={formatHyphenLabel(definition.sharedServiceAccess)}
              />
            </dl>
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Assigned projects
              </div>
              <AssignedProjects
                assignments={assignmentsByPlan.get(definition.planKey) ?? []}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PlanDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function AssignedProjects({
  assignments,
}: {
  assignments: TribePlanAssignment[];
}) {
  if (!assignments.length) {
    return <p className="text-sm text-muted-foreground">No active projects</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {assignments.map((assignment) => (
        <div
          key={assignment.id ?? `${assignment.projectId}-${assignment.planKey}`}
          className="rounded-lg border p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sm">{assignment.projectId}</span>
            <span className="text-xs text-muted-foreground">
              {formatLabel(assignment.planKey)} ·{" "}
              {displayRuntimeEnvironment(assignment.environment)}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {(assignment.effectiveLimits ?? []).map((limit) => (
              <div
                key={`${limit.scope}-${limit.targetServiceId ?? "all"}`}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span>
                  {formatLimitScope(limit.scope)}
                  {limit.targetServiceId
                    ? ` · ${limit.targetServiceId}`
                    : ""}: {formatEffectiveLimit(limit)}
                </span>
                <Badge variant="outline">
                  {limit.source} · {limit.mode}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupAssignmentsByPlan(assignments: TribePlanAssignment[]) {
  const result = new Map<TribePlanKey, TribePlanAssignment[]>();
  for (const assignment of assignments) {
    const current = result.get(assignment.planKey) ?? [];
    current.push(assignment);
    result.set(assignment.planKey, current);
  }
  return result;
}

function formatEffectiveLimit(
  limit: NonNullable<TribePlanAssignment["effectiveLimits"]>[number],
) {
  if (limit.maxRequests === null) return "Unlimited";
  const unit =
    limit.scope === "kafka_publish"
      ? "Kafka publishes"
      : limit.scope === "all"
        ? "calls"
        : "requests";
  const window =
    limit.windowSeconds === 86400 ? "day" : `${limit.windowSeconds}s`;
  return `${limit.maxRequests.toLocaleString()} ${unit}/${window}`;
}

function formatLimitScope(scope: string) {
  if (scope === "all") return "Gateway";
  if (scope === "kafka_publish") return "Kafka";
  return formatLabel(scope);
}

function formatQuota(value: number | null, label: string) {
  return value === null
    ? `custom ${label}`
    : `${value.toLocaleString()} ${label}/day`;
}

function formatHyphenLabel(value: string) {
  return value.replaceAll("-", " ");
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}
