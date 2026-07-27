"use client";

import Link from "next/link";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
