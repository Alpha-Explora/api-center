import type { ServiceRegistryEntry, TenancyProject, TenancyTribe } from "@/lib/schemas";

export type TenancyTreeProject = TenancyProject & {
  registryServices: ServiceRegistryEntry[];
};

export type TenancyTreeTribe = Omit<TenancyTribe, "projects"> & {
  projects: TenancyTreeProject[];
  serviceCount: number;
};

export type TenancyTree = {
  tribes: TenancyTreeTribe[];
  /** Tribe services whose project is missing or unknown; the gateway rejects their tokens. */
  unplaced: ServiceRegistryEntry[];
  shared: ServiceRegistryEntry[];
};

/** Joins the tenancy directory with registry entries: Tribe -> Project -> Service. */
export function buildTenancyTree(
  tribes: TenancyTribe[],
  services: ServiceRegistryEntry[],
): TenancyTree {
  const servicesByProject = new Map<string, ServiceRegistryEntry[]>();
  const knownProjects = new Set(
    tribes.flatMap((tribe) => tribe.projects.map((project) => project.projectId)),
  );
  const unplaced: ServiceRegistryEntry[] = [];
  const shared: ServiceRegistryEntry[] = [];

  for (const service of services) {
    if (service.serviceType === "shared") {
      shared.push(service);
      continue;
    }
    if (!service.projectId || !knownProjects.has(service.projectId)) {
      unplaced.push(service);
      continue;
    }
    servicesByProject.set(service.projectId, [
      ...(servicesByProject.get(service.projectId) ?? []),
      service,
    ]);
  }

  return {
    tribes: tribes.map((tribe) => {
      const projects = tribe.projects.map((project) => ({
        ...project,
        registryServices: servicesByProject.get(project.projectId) ?? [],
      }));
      return {
        ...tribe,
        projects,
        serviceCount: projects.reduce(
          (total, project) => total + project.registryServices.length,
          0,
        ),
      };
    }),
    unplaced,
    shared,
  };
}
