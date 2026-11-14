"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { ActionFailedState } from "@/components/query-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Overview = {
  project: { projectId: string; name: string; status: string; description?: string; costCenter?: string };
  tribe: { tribeId: string; name: string; status: string };
  services: Array<{ serviceId: string; name: string; status: string; environments: Array<{ environment: string; status: string }> }>;
  plans: Array<{ environment: string; assignment: { planKey: string; status: string }; effectiveLimits: Array<{ scope: string; maxRequests: number | null; windowSeconds: number | null; source: string }> }>;
  quotaPolicyOverrides: Array<{ id?: string; scope: string; targetServiceId?: string | null; maxRequests: number; windowSeconds: number; mode: string; reason: string }>;
  paymentConsumerRegistrations: Array<{ consumerServiceId: string; environment: string; status: string }>;
  recentQuotaDecisions: Array<{ id: string; scope: string; outcome: string; requestCount: number; maxRequests: number; createdAt: string | Date }>;
};

type SetupStatus = { projectId: string; serviceId: string; environment: "test" | "live"; checks: Array<{ id: string; status: "ready" | "missing" | "unknown"; detail: string; fix: string }> };

export function ProjectOverviewClient({ projectId }: { projectId: string }) {
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const overviewQuery = useQuery({
    queryKey: ["tenancy", "project-overview", projectId],
    queryFn: async (): Promise<Overview> => {
      const response = await fetch(`/api/local/tenancy/projects/${encodeURIComponent(projectId)}/overview`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load project overview");
      const envelope = await response.json() as { success: boolean; data: Overview };
      if (!envelope.success || !envelope.data) throw new Error("Project overview response was invalid");
      return envelope.data;
    },
  });
  const serviceId = selectedServiceId || overviewQuery.data?.services[0]?.serviceId || "";
  const setupQuery = useQuery({
    queryKey: ["tenancy", "project-setup-status", projectId, serviceId, environment],
    enabled: Boolean(serviceId),
    queryFn: async (): Promise<SetupStatus> => {
      const query = new URLSearchParams({ serviceId, environment });
      const response = await fetch(`/api/local/tenancy/projects/${encodeURIComponent(projectId)}/setup-status?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load setup status");
      const envelope = await response.json() as { success: boolean; data: SetupStatus };
      if (!envelope.success || !envelope.data) throw new Error("Setup status response was invalid");
      return envelope.data;
    },
  });

  if (overviewQuery.isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48 w-full" /></div>;
  if (overviewQuery.isError || !overviewQuery.data) return <ActionFailedState title="Could not load project overview" description="Check your organization access and try again." />;

  const overview = overviewQuery.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeading title={overview.project.name} description={`Project ${overview.project.projectId} · Tribe ${overview.tribe.name} (${overview.tribe.tribeId})`} />
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><CardTitle>Setup status</CardTitle><CardDescription>Checks for a service and environment before its first runtime call.</CardDescription></div>
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">Service
              <select className="h-9 rounded-md border bg-background px-3 text-sm text-foreground" value={serviceId} onChange={(event) => setSelectedServiceId(event.target.value)}>
                {overview.services.map((service) => <option key={service.serviceId} value={service.serviceId}>{service.name} ({service.serviceId})</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">Environment
              <select className="h-9 rounded-md border bg-background px-3 text-sm text-foreground" value={environment} onChange={(event) => setEnvironment(event.target.value as "test" | "live")}>
                <option value="test">Test</option><option value="live">Live</option>
              </select>
            </label>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          {!serviceId ? <p>No services are registered for this project.</p> : null}
          {setupQuery.isLoading ? <p className="text-muted-foreground">Loading setup checks…</p> : null}
          {setupQuery.isError ? <p role="alert" className="text-destructive">Could not load setup checks. Check your organization access and try again.</p> : null}
          {setupQuery.data ? <ul className="divide-y">{setupQuery.data.checks.map((check) => <li key={check.id} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr]">
            <span className={check.status === "ready" ? "font-medium text-emerald-700" : check.status === "missing" ? "font-medium text-destructive" : "font-medium text-muted-foreground"}>{check.status.toUpperCase()}</span>
            <div><p>{check.detail}</p>{check.status !== "ready" ? <p className="mt-1 text-xs text-muted-foreground">{check.fix}</p> : null}</div>
          </li>)}</ul> : null}
        </CardContent>
      </Card>
      <section className="grid gap-4 md:grid-cols-2" aria-label="Project overview">
        <OverviewCard title="Project" description={`${overview.project.status}${overview.project.costCenter ? ` · Cost center ${overview.project.costCenter}` : ""}`}>
          <p>{overview.project.description || "No project description."}</p>
        </OverviewCard>
        <OverviewCard title="Services" description={`${overview.services.length} registered`}>
          {overview.services.length ? <ul className="space-y-2">{overview.services.map((service) => <li key={service.serviceId}><strong>{service.name}</strong> <span className="text-muted-foreground">({service.serviceId}) · {service.status}</span><div className="text-sm text-muted-foreground">{service.environments.map((item) => `${item.environment}: ${item.status}`).join(" · ") || "No environments"}</div></li>)}</ul> : <p>No services registered.</p>}
        </OverviewCard>
        <OverviewCard title="Plans and effective limits" description="Active assignment by environment">
          {overview.plans.length ? <ul className="space-y-3">{overview.plans.map((plan) => <li key={plan.environment}><strong className="capitalize">{plan.environment}: {plan.assignment.planKey}</strong>{plan.effectiveLimits.length ? <ul className="ml-4 list-disc text-sm text-muted-foreground">{plan.effectiveLimits.map((limit, index) => <li key={`${limit.scope}-${index}`}>{limit.scope}: {limit.maxRequests ?? "unlimited"} per {limit.windowSeconds ?? "plan"} seconds ({limit.source})</li>)}</ul> : <p className="text-sm text-muted-foreground">No effective limits reported.</p>}</li>)}</ul> : <p>No active plan assignments.</p>}
        </OverviewCard>
        <OverviewCard title="Quota policy overrides" description={`${overview.quotaPolicyOverrides.length} project policies`}>
          {overview.quotaPolicyOverrides.length ? <ul className="space-y-2">{overview.quotaPolicyOverrides.map((policy, index) => <li key={policy.id ?? `${policy.scope}-${index}`}><strong>{policy.scope}</strong>{policy.targetServiceId ? ` · ${policy.targetServiceId}` : ""} · {policy.maxRequests} per {policy.windowSeconds}s · {policy.mode}<p className="text-sm text-muted-foreground">{policy.reason}</p></li>)}</ul> : <p>No project quota overrides.</p>}
        </OverviewCard>
        <OverviewCard title="Payment consumers" description={`${overview.paymentConsumerRegistrations.length} registrations`}>
          {overview.paymentConsumerRegistrations.length ? <ul className="space-y-2">{overview.paymentConsumerRegistrations.map((consumer) => <li key={`${consumer.consumerServiceId}-${consumer.environment}`}><strong>{consumer.consumerServiceId}</strong> · {consumer.environment} · {consumer.status}</li>)}</ul> : <p>No payment consumer registrations.</p>}
        </OverviewCard>
        <OverviewCard title="Recent quota decisions" description="Latest decisions from the last 24 hours">
          {overview.recentQuotaDecisions.length ? <ul className="space-y-2">{overview.recentQuotaDecisions.map((decision) => <li key={decision.id}>{decision.scope} · {decision.outcome} · {decision.requestCount}/{decision.maxRequests}<p className="text-sm text-muted-foreground">{new Date(decision.createdAt).toLocaleString()}</p></li>)}</ul> : <p>No recent quota decisions.</p>}
        </OverviewCard>
      </section>
    </div>
  );
}

function OverviewCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="text-sm">{children}</CardContent></Card>;
}
