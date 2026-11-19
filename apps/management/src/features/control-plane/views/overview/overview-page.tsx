"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { NativeSelect } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { GoLivePanel } from "./go-live-panel";

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

      {environment ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <UsagePanel />
          <div className="flex flex-col gap-6">
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

function UsagePanel() {
  const { organizationId, project, kind } = useProjectEnvironment();
  const usage = useQuery({ queryKey: cpKeys.usage(organizationId, project.id, kind), queryFn: () => controlPlane.usage(organizationId, project.id, kind), retry: false });
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
    retry: false,
  });
  const names = new Map((applications.data ?? []).map((application) => [application.id, application.name]));

  return (
    <Panel title="Last 24 hours" description="Requests admitted for this environment, by application and action." flush>
      {usage.isLoading ? (
        <div className="p-4">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : usage.error ? (
        <div className="p-4">
          <ErrorPanel title="Usage is unavailable" error={usage.error} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">
            <Stat label="Requests" value={formatNumber(usage.data?.requests)} />
            <Stat label="Completed" value={formatNumber(sum(usage.data?.byApplicationAction, "completed"))} />
            <Stat label="Failed" value={formatNumber(sum(usage.data?.byApplicationAction, "failed"))} tone={sum(usage.data?.byApplicationAction, "failed") > 0 ? "danger" : undefined} />
            <Stat label="Applications" value={formatNumber(applications.data?.length)} href={projectHref(project.id, kind, "/applications")} />
          </div>
          {(usage.data?.byApplicationAction.length ?? 0) === 0 ? (
            <EmptyState title="No requests in the last 24 hours" description="Requests made with this environment's keys appear here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Admitted</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.data?.byApplicationAction.map((row) => (
                  <TableRow key={`${row.applicationId}-${row.action}`}>
                    <TableCell>{names.get(row.applicationId) ?? <span className="font-mono text-xs">{row.applicationId}</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{row.action}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.admitted)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.completed)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", row.failed > 0 && "text-danger")}>{formatNumber(row.failed)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </Panel>
  );
}

function sum(rows: { completed: number; failed: number }[] | undefined, key: "completed" | "failed") {
  return (rows ?? []).reduce((total, row) => total + row[key], 0);
}

function Stat({ label, value, tone, href }: { label: string; value: string; tone?: "danger"; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "danger" && "text-danger")}>{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="px-4 py-3 transition-colors hover:bg-muted/40">
      {body}
    </Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}
