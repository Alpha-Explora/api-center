"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRightIcon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignTribePlan,
  listTribePlanAssignments,
  listTribePlanDefinitions,
  listTribes,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type {
  AssignTribePlanResult,
  GeneratedQuotaPolicyProposal,
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
  const [assignmentResult, setAssignmentResult] =
    useState<AssignTribePlanResult | null>(null);
  const [reviewedAssignment, setReviewedAssignment] = useState(false);

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
    onSuccess: async (result) => {
      setAssignmentResult(result);
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
    setAssignmentResult(null);
    setReviewedAssignment(false);
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
            Plans attach to one project in one environment. Generated quota
            proposals become that project&apos;s budgets, in observe mode.
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
                  onChange={(event) => updateField("projectId", event.target.value)}
                  required
                >
                  <option value="">Choose a project</option>
                  {(tribesQuery.data ?? []).map((tribe) => (
                    <optgroup key={tribe.tribeId} label={`${tribe.name} (${tribe.tribeId})`}>
                      {tribe.projects.map((project) => (
                        <option key={project.projectId} value={project.projectId}>
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
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="text-sm font-medium">Review plan assignment</div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <PlanReviewDetail
                  label="Project"
                  value={form.projectId || "Not set"}
                />
                <PlanReviewDetail label="Plan" value={formatLabel(form.planKey)} />
                <PlanReviewDetail label="Environment" value={form.environment} />
                <PlanReviewDetail label="Quota proposal mode" value="observe" />
              </dl>
              <label
                htmlFor="plan-assignment-reviewed"
                className="mt-3 flex items-start gap-2 text-sm"
              >
                <input
                  id="plan-assignment-reviewed"
                  type="checkbox"
                  className="mt-1"
                  checked={reviewedAssignment}
                  onChange={(event) =>
                    setReviewedAssignment(event.target.checked)
                  }
                />
                <span>
                  I reviewed this plan assignment and the generated quota proposal path.
                </span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={assignMutation.isPending || !reviewedAssignment}
              >
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

          {assignmentResult ? (
            <QuotaProposalList proposals={assignmentResult.quotaProposals} />
          ) : null}
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

function PlanReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
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
                Assigned tribes
              </div>
              <AssignedTribes
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

function AssignedTribes({
  assignments,
}: {
  assignments: TribePlanAssignment[];
}) {
  if (!assignments.length) {
    return <p className="text-sm text-muted-foreground">No active tribes</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {assignments.map((assignment) => (
        <Badge
          key={
            assignment.id ?? `${assignment.projectId}-${assignment.planKey}`
          }
          variant="outline"
          className="gap-1"
        >
          <span className="font-mono">{assignment.projectId}</span>
          <span className="text-muted-foreground">
            {assignment.planKey} / {displayRuntimeEnvironment(assignment.environment)}
          </span>
        </Badge>
      ))}
    </div>
  );
}

function QuotaProposalList({
  proposals,
}: {
  proposals: GeneratedQuotaPolicyProposal[];
}) {
  if (!proposals.length) {
    return (
      <div className="mt-5 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        This plan uses custom quotas. Create policies manually after approval.
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="text-sm font-medium">Generated quota proposals</div>
      {proposals.map((proposal) => (
        <div
          key={`${proposal.scope}-${proposal.maxRequests}`}
          className="flex flex-col gap-2 rounded-md border bg-card p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">{formatLabel(proposal.scope)}</span>{" "}
              {proposal.maxRequests.toLocaleString()} / {proposal.windowSeconds}
              s
            </div>
            <Badge
              variant="secondary"
              className={cn("bg-[#eef7ff] text-[#0b5c8f]")}
            >
              {proposal.mode}
            </Badge>
          </div>
          <Link
            href={quotaProposalHref(proposal)}
            className="inline-flex h-8 items-center gap-1.5 self-start rounded-full border px-3 text-sm font-medium hover:bg-muted"
          >
            <ArrowUpRightIcon className="size-3.5" />
            Open quota proposal
          </Link>
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

function quotaProposalHref(proposal: GeneratedQuotaPolicyProposal) {
  const params = new URLSearchParams({
    ownerTribeId: proposal.ownerTribeId,
    projectId: proposal.projectId,
    scope: proposal.scope,
    windowSeconds: String(proposal.windowSeconds),
    maxRequests: String(proposal.maxRequests),
    mode: proposal.mode,
    reason: proposal.reason,
  });
  if (proposal.targetServiceId) {
    params.set("targetServiceId", proposal.targetServiceId);
  }

  return `/quotas?${params.toString()}`;
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
