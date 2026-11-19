"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { IdText } from "@/components/patterns/copy-button";
import { NativeSelect } from "@/components/patterns/form";
import { PageHeader } from "@/components/patterns/page-header";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import { observabilityKeys } from "../../view-models/observability";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { ActivityPanel } from "./activity-panel";
import { ExpiringKeysPanel } from "./expiring-keys-panel";
import { GettingStartedPanel } from "./getting-started-panel";
import { GoLivePanel } from "./go-live-panel";
import { UsagePanel } from "./usage-panel";

export function OverviewPage() {
  const { project, kind, environment } = useProjectEnvironment();
  const liveEnvironment = project.environments.find((entry) => entry.kind === "live");

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          kind === "live"
            ? "Live serves real traffic. Applications, grants and keys here are separate from test."
            : "Build and try your integration here. Nothing in test is copied to live."
        }
        meta={
          <>
            <span className="font-mono">{project.slug}</span>
            <span aria-hidden>·</span>
            <IdText value={project.id} />
          </>
        }
        actions={environment ? <StatusBadge status={environment.status}>{`${kind === "live" ? "Live" : "Test"} · ${environment.status}`}</StatusBadge> : null}
      />

      {kind === "live" ? <GoLivePanel /> : null}

      {kind === "test" && liveEnvironment?.status !== "active" ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px]">
            <p className="font-medium">{liveEnvironment ? "Live is being set up" : "Ready for real traffic?"}</p>
            <p className="text-muted-foreground">
              {liveEnvironment
                ? "Finish the readiness checks and get the activation approved."
                : "Live is a separate environment that needs a live plan and an approved activation."}
            </p>
          </div>
          <Link href={projectHref(project.id, "live")} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {liveEnvironment ? "Continue going live" : "Go live"} <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </div>
      ) : null}

      {environment ? <GettingStartedPanel /> : null}

      {environment ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-6">
            <UsagePanel />
            <ActivityPanel />
          </div>
          <div className="flex flex-col gap-6">
            <ExpiringKeysPanel />
            <PlanPanel />
            <CapabilitiesSummary />
          </div>
        </div>
      ) : null}
    </>
  );
}

function PlanPanel() {
  const { organizationId, project, kind, canManage } = useProjectEnvironment();
  const client = useQueryClient();
  const plans = useQuery({ queryKey: cpKeys.plans, queryFn: controlPlane.plans, staleTime: 5 * 60_000 });
  const plan = useQuery({ queryKey: cpKeys.plan(organizationId, project.id, kind), queryFn: () => controlPlane.plan(organizationId, project.id, kind), retry: false });
  const assign = useMutation({
    mutationFn: (planKey: string) => controlPlane.assignPlan(organizationId, project.id, kind, planKey),
    onSuccess: () => {
      toast.success("Plan updated");
      void client.invalidateQueries({ queryKey: cpKeys.plan(organizationId, project.id, kind) });
      void client.invalidateQueries({ queryKey: cpKeys.liveReadiness(organizationId, project.id) });
      void client.invalidateQueries({ queryKey: observabilityKeys.quotaUsage(organizationId, project.id, kind) });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const options = (plans.data ?? []).filter((entry) => kind === "test" || entry.liveAllowed);
  const current = (plans.data ?? []).find((entry) => entry.planKey === plan.data?.planKey);

  return (
    <Panel title="Plan" description={kind === "test" ? "Without a plan, test has a bounded daily default." : "Live requests need a live-capable plan."}>
      <div className="flex flex-col gap-3">
        <NativeSelect
          aria-label="Plan"
          value={plan.data?.planKey ?? ""}
          disabled={!canManage || assign.isPending}
          title={canManage ? undefined : PROJECT_ADMIN_REASON}
          onChange={(event) => event.target.value && assign.mutate(event.target.value)}
        >
          <option value="">{kind === "test" ? "Test default" : "No plan"}</option>
          {options.map((entry) => (
            <option key={entry.planKey} value={entry.planKey}>
              {entry.displayName}
            </option>
          ))}
        </NativeSelect>
        <DescriptionList
          items={[
            { label: "Daily requests", value: current ? (current.requestsPerDay === null ? "Unlimited" : formatNumber(current.requestsPerDay)) : kind === "test" ? "Default" : "None" },
            { label: "Live allowed", value: current ? (current.liveAllowed ? "Yes" : "No") : "—" },
          ]}
        />
      </div>
    </Panel>
  );
}

function CapabilitiesSummary() {
  const { project, kind, environment } = useProjectEnvironment();
  const catalog = useQuery({ queryKey: cpKeys.catalog, queryFn: controlPlane.capabilities, staleTime: 5 * 60_000 });
  const enabled = new Set(environment?.capabilities.filter((entry) => entry.status === "enabled").map((entry) => entry.capability));

  return (
    <Panel
      title="Capabilities"
      flush
      actions={
        <Link href={projectHref(project.id, kind, "/capabilities")} className="text-xs text-muted-foreground hover:text-foreground">
          Manage
        </Link>
      }
    >
      <ul className="divide-y">
        {(catalog.data ?? []).map((capability) => {
          const on = enabled.has(capability.id);
          return (
            <li key={capability.id} className="flex h-9 items-center justify-between px-4 text-[13px]">
              <span className={cn(!on && "text-muted-foreground")}>{capability.name}</span>
              <StatusBadge tone={on ? "success" : "neutral"}>{on ? "Enabled" : "Off"}</StatusBadge>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
