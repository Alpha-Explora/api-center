"use client";

import Link from "next/link";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listServices } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { ServiceRegistryEntry } from "@/lib/schemas";
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
                  "Confirm API Center is reachable and the admin secret is configured.",
              },
              {
                label: "Refresh the catalog",
                description:
                  "Retry after the protected registry route responds.",
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
  );
}

function CatalogTable({ services }: { services: ServiceRegistryEntry[] }) {
  return (
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
            <TableHead>Contract</TableHead>
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
              <TableCell>
                <ServiceSpecsCell serviceId={service.serviceId} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type ServiceSpecVersion = {
  version: string;
  format: string;
  sha256: string;
  publishedBy: string;
  publishedAt: string;
};

function ServiceSpecsCell({ serviceId }: { serviceId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const versionsQuery = useQuery({
    queryKey: ["service-spec-versions", serviceId],
    queryFn: () => fetchSpecVersions(serviceId),
    enabled: open,
  });
  const specQuery = useQuery({
    queryKey: ["service-spec", serviceId, selectedVersion],
    queryFn: () => fetchServiceSpec(serviceId, selectedVersion!),
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
                <a
                  className="underline underline-offset-2"
                  href={specDownloadUrl(serviceId, spec.version)}
                >
                  Download
                </a>
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

async function fetchSpecVersions(
  serviceId: string,
): Promise<ServiceSpecVersion[]> {
  const response = await fetch(
    `/api/local/catalog/services/${encodeURIComponent(serviceId)}/spec-versions`,
  );
  if (!response.ok) throw new Error("Could not load specification versions");
  const payload = (await response.json()) as { data?: ServiceSpecVersion[] };
  return payload.data ?? [];
}

async function fetchServiceSpec(
  serviceId: string,
  version: string,
): Promise<unknown> {
  const response = await fetch(
    `/api/local/catalog/services/${encodeURIComponent(serviceId)}/spec-versions/${encodeURIComponent(version)}`,
  );
  if (!response.ok) throw new Error("Could not load specification");
  const payload = (await response.json()) as { data?: { document?: unknown } };
  return payload.data?.document;
}

function specDownloadUrl(serviceId: string, version: string) {
  return `/api/local/catalog/services/${encodeURIComponent(serviceId)}/spec-versions/${encodeURIComponent(version)}?download=1`;
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
