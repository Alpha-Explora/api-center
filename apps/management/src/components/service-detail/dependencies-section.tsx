import Link from "next/link";
import { Detail } from "@/components/service-detail/detail";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function DependenciesCard({
  service,
  services,
  consumers,
  brokenDependencies,
}: {
  service: ServiceRegistryEntry;
  services: ServiceRegistryEntry[];
  consumers: string[];
  brokenDependencies: Array<{
    sourceServiceId: string;
    targetServiceId: string;
  }>;
}) {
  const serviceById = new Map(
    services.map((registryService) => [
      registryService.serviceId,
      registryService,
    ]),
  );
  const directDependencies = service.consumes.map((targetServiceId) => ({
    serviceId: targetServiceId,
    service: serviceById.get(targetServiceId),
  }));
  const consumerServices = consumers.map((consumerServiceId) => ({
    serviceId: consumerServiceId,
    service: serviceById.get(consumerServiceId),
  }));
  const firstBrokenDependency = brokenDependencies[0]?.targetServiceId;
  const nextAction = firstBrokenDependency
    ? `Register ${firstBrokenDependency} or remove it from the manifest.`
    : consumerServices.length > 0
      ? "Review consuming services before changing scopes or status."
      : "No dependency remediation is currently needed.";

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Dependency review</CardTitle>
          <CardDescription>
            Direct registry relationships, consumer impact, and broken links
            for this service.
          </CardDescription>
        </div>
        {firstBrokenDependency ? (
          <Link
            href={`/tribes/${encodeURIComponent(service.serviceId)}/edit`}
            className="inline-flex text-sm font-medium underline-offset-4 hover:underline"
          >
            Edit dependency manifest
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 text-sm md:grid-cols-3">
          <Detail
            label="Direct dependencies"
            value={String(directDependencies.length)}
          />
          <Detail
            label="Consumer impact"
            value={`${consumerServices.length} consuming services`}
          />
          <Detail
            label="Unresolved links"
            value={
              brokenDependencies.length
                ? `${brokenDependencies.length} unresolved`
                : "None"
            }
          />
        </dl>
        <div className="grid gap-3 lg:grid-cols-2">
          <DependencyListPanel
            title="Direct dependencies"
            emptyMessage="This service does not consume another registered service."
            rows={directDependencies.map(({ serviceId, service }) => ({
              id: serviceId,
              name: service?.name ?? serviceId,
              status: service?.status ?? "missing",
              meta: service?.serviceType ?? "missing",
              href: service
                ? `/tribes/${encodeURIComponent(service.serviceId)}?section=summary`
                : undefined,
            }))}
          />
          <DependencyListPanel
            title="Consumer impact"
            emptyMessage="No registered services currently consume this service."
            rows={consumerServices.map(({ serviceId, service }) => ({
              id: serviceId,
              name: service?.name ?? serviceId,
              status: service?.status ?? "unknown",
              meta: service?.ownerTeam ?? "Owner not set",
              href: service
                ? `/tribes/${encodeURIComponent(service.serviceId)}?section=dependencies`
                : undefined,
            }))}
          />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Next dependency action</div>
            {firstBrokenDependency ? (
              <Badge variant="destructive">blocked</Badge>
            ) : (
              <Badge variant="secondary">ready</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{nextAction}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DependencyListPanel({
  title,
  emptyMessage,
  rows,
}: {
  title: string;
  emptyMessage: string;
  rows: Array<{
    id: string;
    name: string;
    status: string;
    meta: string;
    href?: string;
  }>;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
      <div className="text-sm font-medium">{title}</div>
      {rows.length ? (
        <div className="mt-3 divide-y rounded-lg border bg-background">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_8rem]"
            >
              <div className="min-w-0">
                {row.href ? (
                  <Link
                    href={row.href}
                    className="break-words text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                ) : (
                  <div className="break-words text-sm font-medium">
                    {row.name}
                  </div>
                )}
                <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {row.id}
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 md:justify-end">
                <Badge variant={dependencyStatusVariant(row.status)}>
                  {row.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{row.meta}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
      )}
    </div>
  );
}

function dependencyStatusVariant(status: string) {
  if (status === "missing") return "destructive";
  if (status === "active") return "secondary";
  return "outline";
}
