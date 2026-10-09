"use client";

import Link from "next/link";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  downloadServiceSpecDocument,
  getServiceSpecDocument,
  listServiceSpecCatalog,
  listServiceSpecVersions,
  listServices,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { ServiceRegistryEntry } from "@/lib/schemas";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ApiProductCatalog() {
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>API products</CardTitle>
            <CardDescription>
              Scan shared services and tribe APIs as governed platform products.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => servicesQuery.refetch()}
            disabled={servicesQuery.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {servicesQuery.isLoading ? (
            <Skeleton className="h-96 rounded-xl" />
          ) : servicesQuery.isError ? (
            <ActionFailedState
              title="Could not load API catalog"
              description="Check API Center admin credentials and registry availability."
              recoverySteps={[
                {
                  label: "Check registry access",
                  description:
                    "Confirm API Center is reachable and the protected registry route responds.",
                },
                {
                  label: "Refresh the catalog",
                  description: "Retry after the registry becomes available.",
                },
              ]}
            />
          ) : servicesQuery.data?.length ? (
            <CatalogTable services={servicesQuery.data} />
          ) : (
            <EmptyDataState
              title="No APIs registered"
              description="Registered services appear here as API products."
            />
          )}
        </CardContent>
      </Card>
      <ServiceSpecCatalog />
    </>
  );
}

function ServiceSpecCatalog() {
  const catalogQuery = useQuery({
    queryKey: ["service-spec-catalog"],
    queryFn: listServiceSpecCatalog,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>API contracts</CardTitle>
        <CardDescription>
          Published specifications are scoped to the exact service record. The
          organization and project identify services that share a slug.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {catalogQuery.isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : catalogQuery.isError ? (
          <ActionFailedState
            title="Could not load the service contract catalog"
            description="Check management authentication and API Center catalog availability."
            recoverySteps={[
              {
                label: "Check catalog access",
                description:
                  "Confirm the management session and platform admin credentials are valid.",
              },
              {
                label: "Refresh the catalog",
                description: "Retry after API Center responds.",
              },
            ]}
          />
        ) : catalogQuery.data?.length ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Specifications</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogQuery.data.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <div className="font-medium">
                        {service.organizationName}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {service.organizationSlug}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{service.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {service.serviceId}
                      </div>
                    </TableCell>
                    <TableCell>
                      {service.projectName ??
                        service.projectId ??
                        "Shared service"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{service.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <ServiceSpecsCell serviceIdentity={service.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyDataState
            title="No services available for contracts"
            description="Services registered in the database appear here by organization and project."
          />
        )}
      </CardContent>
    </Card>
  );
}

function CatalogTable({ services }: { services: ServiceRegistryEntry[] }) {
  const queryClient = useQueryClient();
  const [consumerProjectId, setConsumerProjectId] = useState("");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [reason, setReason] = useState("");
  const requestMutation = useMutation({
    mutationFn: async (apiServiceId: string) => {
      const response = await fetch("/api/local/catalog/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumerProjectId, apiServiceId, environment, reason }),
      });
      if (!response.ok) throw new Error("Could not request API access");
      return response.json();
    },
    onSuccess: () => {
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["api-subscriptions"] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <label className="grid gap-1 text-sm">
          Consumer project ID
          <input className="h-9 rounded-md border bg-background px-3 font-mono text-xs" value={consumerProjectId} onChange={(event) => setConsumerProjectId(event.target.value)} placeholder="project-id" />
        </label>
        <label className="grid gap-1 text-sm">
          Environment
          <select className="h-9 rounded-md border bg-background px-3" value={environment} onChange={(event) => setEnvironment(event.target.value as "test" | "live")}>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          Request reason
          <input className="h-9 rounded-md border bg-background px-3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What will this API be used for?" />
        </label>
      </div>
      {requestMutation.isError ? <p role="alert" className="text-sm text-destructive">{requestMutation.error.message}</p> : null}
      <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Entitlement</TableHead>
            <TableHead>Quota hint</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>Docs</TableHead>
            <TableHead>Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.serviceId}>
              <TableCell className="min-w-56">
                <Link
                  href={`/tribes/${encodeURIComponent(service.serviceId)}?section=summary`}
                  aria-label={`Open ${service.apiProductName ?? service.name} service detail`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {service.apiProductName ?? service.name}
                </Link>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {service.serviceId}
                </div>
                {service.apiProductDescription ? (
                  <div className="mt-1 max-w-72 text-xs text-muted-foreground">
                    {service.apiProductDescription}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>{ownerLabel(service)}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {service.serviceType ?? "tribe"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{service.status}</Badge>
              </TableCell>
              <TableCell>
                <TokenList items={service.requiredScopes} />
              </TableCell>
              <TableCell>{entitlementLabel(service)}</TableCell>
              <TableCell>{quotaHintLabel(service)}</TableCell>
              <TableCell>
                {service.slaTier ?? service.serviceTier ?? "standard"}
              </TableCell>
              <TableCell>
                {service.documentationUrl ? (
                  <Link
                    href={service.documentationUrl}
                    aria-label={`Open docs for ${service.serviceId}`}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                  >
                    Docs
                    <ExternalLinkIcon className="size-3" />
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">None</span>
                )}
              </TableCell>
              <TableCell className="min-w-48 space-y-2">
                {(service.serviceType ?? "tribe") === "tribe" && service.projectId !== consumerProjectId ? (
                  <Button type="button" size="sm" disabled={!consumerProjectId.trim() || requestMutation.isPending} onClick={() => requestMutation.mutate(service.serviceId)}>
                    Request access
                  </Button>
                ) : null}
                {service.projectId ? <AccessRequestsCell serviceId={service.serviceId} /> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

type ApiSubscription = {
  id: string;
  consumerProjectId: string;
  apiServiceId: string;
  environment: "test" | "live";
  status: "pending" | "approved" | "rejected" | "revoked";
  requestedBy: string;
  reason: string | null;
};

function AccessRequestsCell({ serviceId }: { serviceId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const requestsQuery = useQuery({
    queryKey: ["api-subscriptions", "owner", serviceId],
    queryFn: async () => {
      const response = await fetch(`/api/local/catalog/subscriptions?apiServiceId=${encodeURIComponent(serviceId)}`);
      if (!response.ok) throw new Error("Could not load access requests");
      const payload = (await response.json()) as { data?: ApiSubscription[] };
      return payload.data ?? [];
    },
    enabled: open,
  });
  const decisionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" | "revoke" }) => {
      const response = await fetch(`/api/local/catalog/subscriptions/${encodeURIComponent(id)}/${action}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(`Could not ${action} access`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-subscriptions", "owner", serviceId] }),
  });

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)}>
        {open ? "Hide requests" : "Manage requests"}
      </Button>
      {open ? (
        <div className="space-y-2">
          {requestsQuery.isLoading ? <p className="text-xs text-muted-foreground">Loading requests…</p> : null}
          {requestsQuery.isError ? <p role="alert" className="text-xs text-destructive">Could not load requests.</p> : null}
          {requestsQuery.data?.length === 0 ? <p className="text-xs text-muted-foreground">No access requests.</p> : null}
          {requestsQuery.data?.map((request) => (
            <div key={request.id} className="rounded-md border p-2 text-xs">
              <div className="font-mono">{request.consumerProjectId} · {request.environment} · {request.status}</div>
              {request.reason ? <p className="mt-1 text-muted-foreground">{request.reason}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {request.status === "pending" ? <>
                  <Button size="sm" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate({ id: request.id, action: "approve" })}>Approve</Button>
                  <Button size="sm" variant="outline" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate({ id: request.id, action: "reject" })}>Reject</Button>
                </> : null}
                {request.status === "approved" ? <Button size="sm" variant="outline" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate({ id: request.id, action: "revoke" })}>Revoke</Button> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ServiceSpecsCell({ serviceIdentity }: { serviceIdentity: string }) {
  const [open, setOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const versionsQuery = useQuery({
    queryKey: ["service-spec-versions", serviceIdentity],
    queryFn: () => listServiceSpecVersions(serviceIdentity),
    enabled: open,
  });
  const specQuery = useQuery({
    queryKey: ["service-spec", serviceIdentity, selectedVersion],
    queryFn: () => getServiceSpecDocument(serviceIdentity, selectedVersion!),
    enabled: open && selectedVersion !== null,
  });

  return (
    <div className="min-w-48 space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide versions" : "View versions"}
      </Button>
      {open ? (
        <div className="space-y-2">
          {versionsQuery.isLoading ? (
            <span className="text-xs text-muted-foreground">Loading…</span>
          ) : null}
          {versionsQuery.isError ? (
            <span className="text-xs text-destructive">
              Could not load specifications.
            </span>
          ) : null}
          {versionsQuery.data?.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No published contract
            </span>
          ) : null}
          {versionsQuery.data?.map((spec) => (
            <div
              key={`${spec.version}:${spec.sha256}`}
              className="rounded-md border p-2 text-xs"
            >
              <div className="font-medium">
                {spec.version}{" "}
                <span className="text-muted-foreground">· {spec.format}</span>
              </div>
              <div className="mt-1 flex gap-3">
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => setSelectedVersion(spec.version)}
                >
                  View
                </button>
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => {
                    void downloadServiceSpecDocument(
                      serviceIdentity,
                      spec.version,
                    ).catch(() =>
                      toast.error(
                        "Could not download the service specification",
                      ),
                    );
                  }}
                >
                  Download
                </button>
              </div>
            </div>
          ))}
          {specQuery.data ? (
            <pre className="max-h-72 max-w-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(specQuery.data, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TokenList({ items }: { items: string[] }) {
  return (
    <div className="flex max-w-64 flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant="outline" className="font-mono">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function ownerLabel(service: ServiceRegistryEntry) {
  return service.ownerTeam ?? service.ownerTribeId ?? service.serviceId;
}

function entitlementLabel(service: ServiceRegistryEntry) {
  if ((service.serviceType ?? "tribe") === "shared") return "Plan required";
  return service.ownerTribeId ? "Tribe-owned" : "Root tribe";
}

function quotaHintLabel(service: ServiceRegistryEntry) {
  const hints = service.quotaHints;
  if (hints?.recommendedMaxRequests && hints.recommendedWindowSeconds) {
    return `${hints.recommendedMaxRequests.toLocaleString()} / ${hints.recommendedWindowSeconds}s`;
  }
  if (service.providerCostSensitive || hints?.providerCostSensitive) {
    return "Target quota";
  }
  return "None";
}
