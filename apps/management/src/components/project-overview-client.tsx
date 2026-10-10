"use client";

import { useQuery } from "@tanstack/react-query";
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

export function ProjectOverviewClient({ projectId }: { projectId: string }) {
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

  if (overviewQuery.isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48 w-full" /></div>;
  if (overviewQuery.isError || !overviewQuery.data) return <ActionFailedState title="Could not load project overview" description="Check your organization access and try again." />;

  const overview = overviewQuery.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeading title={overview.project.name} description={`Project ${overview.project.projectId} · Tribe ${overview.tribe.name} (${overview.tribe.tribeId})`} />
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
