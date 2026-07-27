"use client";

import { useMemo, useState } from "react";
import { BanIcon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disableQuotaPolicy,
  listQuotaPolicies,
  saveQuotaPolicy,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { QuotaMode, QuotaPolicy, QuotaScope } from "@/lib/schemas";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const quotaScopes: QuotaScope[] = ["all", "shared", "tribe", "kafka_publish"];
const quotaModes: QuotaMode[] = ["observe", "enforce"];

type PolicyFormState = {
  ownerTribeId: string;
  scope: QuotaScope;
  targetServiceId: string;
  windowSeconds: string;
  maxRequests: string;
  burstRequests: string;
  mode: QuotaMode;
  reason: string;
};

export function TribeQuotaPolicyPanel({
  ownerTribeId,
  initialPolicy,
}: {
  ownerTribeId?: string;
  initialPolicy?: Partial<PolicyFormState>;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PolicyFormState>({
    ownerTribeId: initialPolicy?.ownerTribeId ?? ownerTribeId ?? "",
    scope: initialPolicy?.scope ?? "shared",
    targetServiceId: initialPolicy?.targetServiceId ?? "",
    windowSeconds: initialPolicy?.windowSeconds ?? "60",
    maxRequests: initialPolicy?.maxRequests ?? "100",
    burstRequests: initialPolicy?.burstRequests ?? "",
    mode: initialPolicy?.mode ?? "observe",
    reason: initialPolicy?.reason ?? "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [reviewedSave, setReviewedSave] = useState(false);
  const policiesQuery = useQuery({
    queryKey: queryKeys.quotaPolicies(ownerTribeId ?? "all"),
    queryFn: () => listQuotaPolicies(ownerTribeId),
  });
  const saveMutation = useMutation({
    mutationFn: (input: Parameters<typeof saveQuotaPolicy>[0]) =>
      saveQuotaPolicy(input),
    onSuccess: async () => {
      setMessage("Quota policy saved.");
      await queryClient.invalidateQueries({ queryKey: ["quotas", "policies"] });
    },
  });
  const disableMutation = useMutation({
    mutationFn: (policyId: string) => disableQuotaPolicy(policyId),
    onSuccess: async () => {
      setMessage("Quota policy disabled.");
      await queryClient.invalidateQueries({ queryKey: ["quotas", "policies"] });
    },
  });
  const activePolicies = useMemo(
    () =>
      (policiesQuery.data ?? []).filter((policy) => policy.status === "active"),
    [policiesQuery.data],
  );

  function updateField<K extends keyof PolicyFormState>(
    key: K,
    value: PolicyFormState[K],
  ) {
    setMessage(null);
    setReviewedSave(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.mutate({
      ownerTribeId: form.ownerTribeId,
      scope: form.scope,
      targetServiceId: form.targetServiceId,
      windowSeconds: Number(form.windowSeconds),
      maxRequests: Number(form.maxRequests),
      burstRequests: form.burstRequests ? Number(form.burstRequests) : null,
      mode: form.mode,
      reason: form.reason,
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Quota policies</CardTitle>
          <CardDescription>
            Set tribe call limits in observe mode first, then move
            high-confidence policies to enforce.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => policiesQuery.refetch()}
          disabled={policiesQuery.isFetching}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[minmax(20rem,28rem)_1fr]">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="quota-owner-tribe-id">
                  Owner tribe ID
                </FieldLabel>
                <Input
                  id="quota-owner-tribe-id"
                  value={form.ownerTribeId}
                  onChange={(event) =>
                    updateField("ownerTribeId", event.target.value)
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="quota-scope">Scope</FieldLabel>
                <select
                  id="quota-scope"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={form.scope}
                  onChange={(event) =>
                    updateField("scope", event.target.value as QuotaScope)
                  }
                >
                  {quotaScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {formatScope(scope)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="quota-target-service-id">
                Target service ID
              </FieldLabel>
              <Input
                id="quota-target-service-id"
                value={form.targetServiceId}
                onChange={(event) =>
                  updateField("targetServiceId", event.target.value)
                }
                placeholder="Optional"
              />
              <FieldDescription>
                Leave blank to apply the quota across the selected scope.
              </FieldDescription>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="quota-window-seconds">
                  Window seconds
                </FieldLabel>
                <Input
                  id="quota-window-seconds"
                  type="number"
                  min={1}
                  value={form.windowSeconds}
                  onChange={(event) =>
                    updateField("windowSeconds", event.target.value)
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="quota-max-requests">
                  Max requests
                </FieldLabel>
                <Input
                  id="quota-max-requests"
                  type="number"
                  min={1}
                  value={form.maxRequests}
                  onChange={(event) =>
                    updateField("maxRequests", event.target.value)
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="quota-burst-requests">
                  Burst requests
                </FieldLabel>
                <Input
                  id="quota-burst-requests"
                  type="number"
                  min={1}
                  value={form.burstRequests}
                  onChange={(event) =>
                    updateField("burstRequests", event.target.value)
                  }
                  placeholder="Optional"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="quota-mode">Mode</FieldLabel>
              <select
                id="quota-mode"
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={form.mode}
                onChange={(event) =>
                  updateField("mode", event.target.value as QuotaMode)
                }
              >
                {quotaModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {formatMode(mode)}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="quota-reason">Change reason</FieldLabel>
              <Textarea
                id="quota-reason"
                value={form.reason}
                onChange={(event) => updateField("reason", event.target.value)}
                required
              />
            </Field>
          </FieldGroup>
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="text-sm font-medium">Review quota change</div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <QuotaReviewDetail label="Tribe" value={form.ownerTribeId || "Not set"} />
              <QuotaReviewDetail label="Scope" value={formatScope(form.scope)} />
              <QuotaReviewDetail
                label="Target"
                value={form.targetServiceId || "All targets"}
              />
              <QuotaReviewDetail
                label="Limit"
                value={`${form.maxRequests || "0"} / ${form.windowSeconds || "0"}s`}
              />
              <QuotaReviewDetail label="Mode" value={formatMode(form.mode)} />
              <QuotaReviewDetail
                label="Burst"
                value={form.burstRequests || "No burst"}
              />
            </dl>
            <label
              htmlFor="quota-change-reviewed"
              className="mt-3 flex items-start gap-2 text-sm"
            >
              <input
                id="quota-change-reviewed"
                type="checkbox"
                className="mt-1"
                checked={reviewedSave}
                onChange={(event) => setReviewedSave(event.target.checked)}
              />
              <span>
                I reviewed this quota change and confirm observe/enforce mode is correct.
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saveMutation.isPending || !reviewedSave}>
              <SaveIcon data-icon="inline-start" />
              Save quota policy
            </Button>
            {message ? (
              <span className="text-sm text-muted-foreground">{message}</span>
            ) : null}
            {saveMutation.isError || disableMutation.isError ? (
              <span className="text-sm text-destructive">
                {(saveMutation.error ?? disableMutation.error)?.message}
              </span>
            ) : null}
          </div>
        </form>

        <PolicyTable
          policies={policiesQuery.data ?? []}
          activePolicies={activePolicies}
          isLoading={policiesQuery.isLoading}
          isError={policiesQuery.isError}
          disablingPolicyId={
            disableMutation.isPending
              ? (disableMutation.variables as string | undefined)
              : undefined
          }
          onDisable={(policyId) => disableMutation.mutate(policyId)}
        />
      </CardContent>
    </Card>
  );
}

function QuotaReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function PolicyTable({
  policies,
  activePolicies,
  isLoading,
  isError,
  disablingPolicyId,
  onDisable,
}: {
  policies: QuotaPolicy[];
  activePolicies: QuotaPolicy[];
  isLoading: boolean;
  isError: boolean;
  disablingPolicyId?: string;
  onDisable: (policyId: string) => void;
}) {
  if (isLoading) return <Skeleton className="h-80 rounded-xl" />;
  if (isError) {
    return (
      <ActionFailedState
        title="Could not load quota policies"
        description="Check the API Center admin secret and quota controller deployment."
        recoverySteps={[
          {
            label: "Check quota controller deployment",
            description:
              "Policy review needs the quota controller before edits are safe.",
          },
          {
            label: "Verify admin secret",
            description:
              "Confirm server-only management credentials can read quota policies.",
          },
        ]}
      />
    );
  }
  if (!policies.length) {
    return (
      <EmptyDataState
        title="No quota policies configured"
        description="Create an observe-mode policy before enforcing tribe-specific limits."
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="text-sm text-muted-foreground">
        {activePolicies.length} active of {policies.length} policies
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tribe</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((policy) => (
              <TableRow key={policy.id}>
                <TableCell className="font-mono text-xs">
                  {policy.ownerTribeId}
                </TableCell>
                <TableCell>{formatScope(policy.scope)}</TableCell>
                <TableCell>{policy.targetServiceId ?? "All targets"}</TableCell>
                <TableCell>
                  {policy.maxRequests} / {policy.windowSeconds}s
                  {policy.burstRequests ? (
                    <span className="block text-xs text-muted-foreground">
                      burst {policy.burstRequests}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      policy.mode === "enforce" ? "destructive" : "secondary"
                    }
                    className={cn(
                      policy.mode === "observe" &&
                        "bg-[#eef7ff] text-[#0b5c8f]",
                    )}
                  >
                    {formatMode(policy.mode)}
                  </Badge>
                </TableCell>
                <TableCell>{policy.status}</TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Disable ${policy.id}`}
                    disabled={
                      policy.status === "disabled" ||
                      disablingPolicyId === policy.id
                    }
                    onClick={() => onDisable(policy.id)}
                  >
                    <BanIcon data-icon="inline-start" />
                    Disable
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function formatScope(scope: QuotaScope) {
  return scope.replace("_", " ");
}

function formatMode(mode: QuotaMode) {
  return mode === "enforce" ? "enforce" : "observe";
}
