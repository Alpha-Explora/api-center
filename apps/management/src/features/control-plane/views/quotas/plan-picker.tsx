"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { NativeSelect } from "@/components/patterns/form";
import { formatNumber } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import { observabilityKeys } from "../../view-models/observability";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

/** The environment's plan. Changing live's plan changes what live traffic may do, so it is confirmed. */
export function PlanPicker() {
  const { organizationId, project, kind, canManage } = useProjectEnvironment();
  const client = useQueryClient();
  const plans = useQuery({ queryKey: cpKeys.plans, queryFn: controlPlane.plans, staleTime: 5 * 60_000 });
  const plan = useQuery({ queryKey: cpKeys.plan(organizationId, project.id, kind), queryFn: () => controlPlane.plan(organizationId, project.id, kind) });
  const [pending, setPending] = useState<string | null>(null);
  const assign = useMutation({
    mutationFn: (planKey: string) => controlPlane.assignPlan(organizationId, project.id, kind, planKey),
    onSuccess: () => {
      toast.success("Plan updated");
      setPending(null);
      void client.invalidateQueries({ queryKey: cpKeys.plan(organizationId, project.id, kind) });
      void client.invalidateQueries({ queryKey: cpKeys.liveReadiness(organizationId, project.id) });
      void client.invalidateQueries({ queryKey: observabilityKeys.quotaUsage(organizationId, project.id, kind) });
    },
    onError: (error: Error) => {
      setPending(null);
      toast.error(error.message);
    },
  });
  const options = (plans.data ?? []).filter((entry) => kind === "test" || entry.liveAllowed);
  const next = options.find((entry) => entry.planKey === pending);

  return (
    <>
      <NativeSelect
        aria-label={`${kind === "live" ? "Live" : "Test"} plan`}
        className="w-48"
        value={plan.data?.planKey ?? ""}
        disabled={!canManage || assign.isPending || plans.isPending}
        title={canManage ? undefined : PROJECT_ADMIN_REASON}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) return;
          if (kind === "live") setPending(value);
          else assign.mutate(value);
        }}
      >
        <option value="">{kind === "test" ? "Test default" : "No plan"}</option>
        {options.map((entry) => (
          <option key={entry.planKey} value={entry.planKey}>
            {entry.displayName}
            {entry.requestsPerDay === null ? " · unlimited" : ` · ${formatNumber(entry.requestsPerDay)}/day`}
          </option>
        ))}
      </NativeSelect>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Switch live to the ${next?.displayName ?? pending} plan`}
        description={`Live's daily allowance becomes ${next?.requestsPerDay === null ? "unlimited" : `${formatNumber(next?.requestsPerDay ?? 0)} requests per UTC day`} from the next request.`}
        confirmLabel="Switch plan"
        busy={assign.isPending}
        onConfirm={() => pending && assign.mutate(pending)}
      />
    </>
  );
}
