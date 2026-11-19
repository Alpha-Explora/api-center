"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, WaypointsIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { NativeSelect } from "@/components/patterns/form";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { controlPlane } from "../../data/control-plane-repository";
import { publishedApis } from "../../data/published-apis";
import type { EnvironmentKind } from "../../model/control-plane";
import { catalogMatches, type CatalogApi } from "../../model/published-apis";
import { cpKeys } from "../../view-models/query-keys";
import { apiKeys } from "../../view-models/published-apis";
import { useAccess, useOrganization } from "../../view-models/use-organization";

type EnvironmentFilter = "all" | EnvironmentKind;

/** Every active API in the organization, for people deciding what their applications can call. */
export function ApiCatalogPage() {
  const { organizationId } = useOrganization();
  const { access } = useAccess(organizationId);
  const catalog = useQuery({
    queryKey: apiKeys.catalog(organizationId ?? "none"),
    queryFn: () => publishedApis.catalog(organizationId as string),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const projects = useQuery({
    queryKey: cpKeys.projects(organizationId ?? "none"),
    queryFn: () => controlPlane.listProjects(organizationId as string),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentFilter>("all");
  const [projectId, setProjectId] = useState("all");

  if (!organizationId) return <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />;

  const projectNames = new Map((projects.data ?? []).map((entry) => [entry.id, entry.name]));
  const projectName = (id: string) => projectNames.get(id) ?? id;
  const all = catalog.data ?? [];
  const publishingProjects = [...new Set(all.map((api) => api.projectId))].sort((a, b) => projectName(a).localeCompare(projectName(b)));
  const visible = all.filter(
    (api) =>
      (environment === "all" || api.environmentKind === environment) &&
      (projectId === "all" || api.projectId === projectId) &&
      catalogMatches(api, query, projectNames.get(api.projectId)),
  );
  const groups = publishingProjects
    .map((id) => ({ id, apis: visible.filter((api) => api.projectId === id).sort(byEnvironmentThenName) }))
    .filter((group) => group.apis.length > 0);

  return (
    <>
      <PageHeader
        title="API catalog"
        description="Active APIs that projects in this organization publish. To call one, request access from an application's Access tab in the same environment."
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Filter APIs" placeholder="Filter by name, path or action" className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="flex gap-2">
          <NativeSelect aria-label="Environment" className="sm:w-32" value={environment} onChange={(event) => setEnvironment(event.target.value as EnvironmentFilter)}>
            <option value="all">Test and live</option>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </NativeSelect>
          <NativeSelect aria-label="Project" className="sm:w-48" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">All projects</option>
            {publishingProjects.map((id) => (
              <option key={id} value={id}>
                {projectName(id)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {catalog.error ? (
        <ErrorPanel title="The API catalog could not be loaded" error={catalog.error} />
      ) : catalog.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={<WaypointsIcon />}
            title="No APIs published yet"
            description="A project publishes an API from its APIs section. Only active APIs appear here."
          />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border bg-card">
          <EmptyState icon={<SearchIcon />} title="No APIs match" description="Try another word or clear the filters." />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-3" aria-label={projectName(group.id)}>
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{projectName(group.id)}</h2>
            {group.apis.map((api) => (
              <CatalogEntry key={api.id} api={api} href={access.projectRole(api.projectId) ? projectHref(api.projectId, api.environmentKind, `/apis/${api.id}`) : undefined} />
            ))}
          </section>
        ))
      )}
    </>
  );
}

function byEnvironmentThenName(a: CatalogApi, b: CatalogApi) {
  return a.environmentKind === b.environmentKind ? a.name.localeCompare(b.name) : a.environmentKind === "test" ? -1 : 1;
}

function CatalogEntry({ api, href }: { api: CatalogApi; href?: string }) {
  return (
    <Panel
      flush
      title={
        <span className="flex flex-wrap items-center gap-2">
          {href ? (
            <Link href={href} className="hover:underline">
              {api.name}
            </Link>
          ) : (
            api.name
          )}
          <StatusBadge tone={api.environmentKind === "live" ? "danger" : "neutral"}>{api.environmentKind === "live" ? "Live" : "Test"}</StatusBadge>
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="font-mono text-xs">{api.slug}</span>
          <IdText value={api.id} />
        </span>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Method</TableHead>
            <TableHead>Path</TableHead>
            <TableHead>Action</TableHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {api.operations.map((operation) => (
            <TableRow key={`${operation.method} ${operation.path}`}>
              <TableCell className="font-mono text-xs font-medium">{operation.method}</TableCell>
              <TableCell className="font-mono text-xs break-all whitespace-normal">{operation.path}</TableCell>
              <TableCell className="font-mono text-xs">{operation.action}</TableCell>
              <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">{operation.description || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
