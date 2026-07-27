"use client";

import Link from "next/link";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listServices } from "@/lib/api-center-client";
import { getServiceEventTopics } from "@/lib/event-topics";
import { queryKeys } from "@/lib/query-keys";
import { StatusBadge } from "@/components/status-badge";
import {
  emptyRegistryFilters,
  RegistryFiltersPanel,
  type RegistryFilters,
} from "@/components/registry-filters";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const REGISTRY_PAGE_SIZE = 8;

export function TribeListClient() {
  const [filters, setFilters] = useState<RegistryFilters>(emptyRegistryFilters);
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });

  const grouped = useMemo(() => {
    const services = (servicesQuery.data ?? []).filter((service) =>
      matchesFilters(service, filters),
    );

    return {
      tribe: services.filter(
        (service) =>
          (service.serviceType ?? "tribe") === "tribe" &&
          service.status !== "retired" &&
          service.status !== "deprecated",
      ),
      shared: services.filter(
        (service) =>
          service.serviceType === "shared" &&
          service.status !== "retired" &&
          service.status !== "deprecated",
      ),
      lifecycle: services.filter(
        (service) =>
          service.status === "retired" || service.status === "deprecated",
      ),
    };
  }, [filters, servicesQuery.data]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Service registry</CardTitle>
          <CardDescription>
            Runtime services registered in API Center Redis through the
            protected registry API.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => servicesQuery.refetch()}
            disabled={servicesQuery.isFetching}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
          <Button nativeButton={false} render={<Link href="/tribes/new" />}>
            <PlusIcon data-icon="inline-start" />
            Register service
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <RegistryFiltersPanel value={filters} onChange={setFilters} />
        </div>
        {servicesQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : servicesQuery.isError ? (
          <ActionFailedState
            title="Could not load services"
            description="Check API_CENTER_BASE_URL and the server-only API_CENTER_PLATFORM_ADMIN_SECRET in the management environment."
            recoverySteps={[
              {
                label: "Check API Center base URL",
                description:
                  "Confirm the management app points at the API Center instance.",
              },
              {
                label: "Check platform admin secret",
                description:
                  "The protected registry API needs the server-only admin secret.",
              },
            ]}
          />
        ) : servicesQuery.data?.length ? (
          <Tabs defaultValue="tribe">
            <TabsList variant="line">
              <TabsTrigger value="tribe">
                Tribe services ({grouped.tribe.length})
              </TabsTrigger>
              <TabsTrigger value="shared">
                Shared services ({grouped.shared.length})
              </TabsTrigger>
              <TabsTrigger value="lifecycle">
                Deprecated/retired ({grouped.lifecycle.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tribe">
              <RegistryTable
                key={getRegistryTableKey(grouped.tribe)}
                services={grouped.tribe}
              />
            </TabsContent>
            <TabsContent value="shared">
              <RegistryTable
                key={getRegistryTableKey(grouped.shared)}
                services={grouped.shared}
              />
            </TabsContent>
            <TabsContent value="lifecycle">
              <RegistryTable
                key={getRegistryTableKey(grouped.lifecycle)}
                services={grouped.lifecycle}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <EmptyDataState
            title="No services registered yet"
            description="Register the first service manifest after the platform secret is configured."
          />
        )}
      </CardContent>
    </Card>
  );
}

function matchesFilters(
  service: ServiceRegistryEntry,
  filters: RegistryFilters,
) {
  const query = filters.query.toLowerCase().trim();
  const owner = filters.ownerTeam.toLowerCase().trim();

  if (query) {
    const haystack = [
      service.serviceId,
      service.name,
      service.baseUrl,
      service.ownerTeam,
      service.contact,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(query)) return false;
  }

  if (owner && !(service.ownerTeam ?? "").toLowerCase().includes(owner)) {
    return false;
  }

  if (filters.status && service.status !== filters.status) return false;

  if (
    filters.serviceType &&
    (service.serviceType ?? "tribe") !== filters.serviceType
  ) {
    return false;
  }

  return true;
}

function getRegistryTableKey(services: ServiceRegistryEntry[]) {
  return services.map((service) => service.serviceId).join("|");
}

function RegistryTable({ services }: { services: ServiceRegistryEntry[] }) {
  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(services.length / REGISTRY_PAGE_SIZE));
  const activePage = Math.min(currentPage, totalPages - 1);
  const pageStart = activePage * REGISTRY_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + REGISTRY_PAGE_SIZE, services.length);
  const pagedServices = services.slice(pageStart, pageEnd);
  const showPagination = services.length > REGISTRY_PAGE_SIZE;

  if (services.length === 0) {
    return (
      <EmptyDataState
        title="No entries in this group"
        description="Registry entries will appear here after API Center returns them."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Backend URL</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Event topic</TableHead>
              <TableHead>Consumes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedServices.map((service) => (
              <TableRow key={service.serviceId}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{service.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {service.serviceId} - {service.serviceType ?? "tribe"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-72 truncate font-mono text-[13px]">
                  {service.baseUrl}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{service.ownerTeam || "Unassigned"}</span>
                    <span className="text-xs text-muted-foreground">
                      {service.contact || "No contact"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-[13px]">
                  {
                    getServiceEventTopics({
                      serviceId: service.serviceId,
                      ownerTribeId: service.ownerTribeId,
                      serviceType:
                        service.serviceType === "shared" ? "shared" : "tribe",
                    }).primary
                  }
                </TableCell>
                <TableCell>{service.consumes.length}</TableCell>
                <TableCell>
                  <StatusBadge status={service.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {service.updatedAt
                    ? new Date(service.updatedAt).toLocaleString()
                    : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                    render={<Link href={serviceSummaryHref(service.serviceId)} />}
                  >
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {showPagination ? (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {pageStart + 1}-{pageEnd} of {services.length} services
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(page - 1, 0))}
              disabled={activePage === 0}
              aria-label="Previous page"
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Previous
            </Button>
            <span className="font-mono text-xs">
              {activePage + 1}/{totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((page) => Math.min(page + 1, totalPages - 1))
              }
              disabled={activePage >= totalPages - 1}
              aria-label="Next page"
            >
              Next
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function serviceSummaryHref(serviceId: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=summary`;
}
