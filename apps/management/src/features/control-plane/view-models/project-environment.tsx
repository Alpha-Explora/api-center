"use client";
import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RocketIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { projectHref } from "@/lib/app-navigation";
import { controlPlane } from "../data/control-plane-repository";
import type { Access } from "../model/access";
import type { EnvironmentKind, Project, ProjectEnvironment } from "../model/control-plane";
import { cpKeys } from "./query-keys";
import { useAccess, useOrganization } from "./use-organization";

export type ProjectEnvironmentContext = {
  organizationId: string;
  project: Project;
  kind: EnvironmentKind;
  /** Undefined when the project has no environment of this kind yet (live before provisioning). */
  environment: ProjectEnvironment | undefined;
  access: Access;
  canWrite: boolean;
  canManage: boolean;
};

const Context = createContext<ProjectEnvironmentContext | null>(null);

export function useProjectEnvironment() {
  const value = useContext(Context);
  if (!value) throw new Error("useProjectEnvironment must be used inside a project environment page");
  return value;
}

/** Loads the project and the person's roles once for every page under /projects/:projectId/:env. */
export function ProjectEnvironmentProvider({ projectId, kind, children }: { projectId: string; kind: EnvironmentKind; children: ReactNode }) {
  const { organizationId, loading } = useOrganization();
  const { access, loading: accessLoading } = useAccess(organizationId);
  const project = useQuery({
    queryKey: cpKeys.project(organizationId ?? "none", projectId),
    queryFn: () => controlPlane.project(organizationId as string, projectId),
    enabled: Boolean(organizationId),
    retry: false,
  });

  if (!loading && !organizationId) {
    return <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />;
  }
  if (project.error) return <ErrorPanel title="This project could not be loaded" error={project.error} />;
  if (!project.data || !organizationId || accessLoading) return <PageSkeleton />;

  const environment = project.data.environments.find((entry) => entry.kind === kind);
  const value: ProjectEnvironmentContext = {
    organizationId,
    project: project.data,
    kind,
    environment,
    access,
    canWrite: access.canWriteEnvironment(project.data.id, kind),
    canManage: access.canManageProject(project.data.id),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** For sections that need the environment to exist: explains that live is not set up and links to going live. */
export function RequireEnvironment({ children }: { children: ReactNode }) {
  const { environment, kind, project } = useProjectEnvironment();
  if (environment) return children;
  return (
    <div className="rounded-lg border bg-card">
      <EmptyState
        icon={<RocketIcon />}
        title={`This project has no ${kind} environment yet`}
        description="Live is a separate environment with its own applications, grants and keys. Set it up from the overview."
        action={
          <Link href={projectHref(project.id, kind)} className={buttonVariants({ variant: "outline" })}>
            Go to overview
          </Link>
        }
      />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
