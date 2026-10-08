import { getServiceEventTopics } from "@/lib/event-topics";
import { isPlatformCapability } from "@/lib/platform-capabilities";
import {
  serviceManifestSchema,
  type RegistrationPlanIssue,
  type ServiceManifest,
  type ServiceRegistrationPlan,
  type ServiceRegistryEntry,
  type TenancyProject,
} from "@/lib/schemas";

export type RegistrationMode = "local-direct" | "production-request";

/**
 * Dry-run a manifest batch against the registry and the tenancy directory.
 * Tribe services must name an active project; their tribe comes from that project.
 */
export function buildServiceRegistrationPlan(input: {
  manifests: ServiceManifest[];
  existingServices: ServiceRegistryEntry[];
  projects: TenancyProject[];
  mode: RegistrationMode;
}): ServiceRegistrationPlan {
  const manifests = input.manifests.map((manifest) =>
    serviceManifestSchema.parse(manifest),
  );
  const issues: RegistrationPlanIssue[] = [];
  const existingById = new Map(
    input.existingServices.map((service) => [service.serviceId, service]),
  );
  const projectsById = new Map(
    input.projects.map((project) => [project.projectId, project]),
  );
  const batchById = new Map<string, ServiceManifest>();

  for (const manifest of manifests) {
    if (batchById.has(manifest.serviceId)) {
      issues.push({
        severity: "blocking",
        code: "duplicate-service-id",
        serviceId: manifest.serviceId,
        message: `Manifest batch contains duplicate serviceId '${manifest.serviceId}'.`,
      });
    }
    batchById.set(manifest.serviceId, manifest);
  }

  const items = manifests.map((manifest) => {
    const project = manifest.projectId ? projectsById.get(manifest.projectId) : undefined;
    validatePlacement(manifest, project, existingById.get(manifest.serviceId), issues);
    validateConsumes(manifest, existingById, batchById, input.mode, issues);
    validateOperationalHints(manifest, issues);
    const ownerTribeId = project?.tribeId ?? null;

    return {
      serviceId: manifest.serviceId,
      ownerTribeId,
      projectId: manifest.projectId ?? null,
      sourceServiceId: manifest.serviceId,
      eventTopic: getServiceEventTopics({
        serviceId: manifest.serviceId,
        ownerTribeId: ownerTribeId ?? undefined,
        serviceType: manifest.serviceType,
      }).primary,
      action: existingById.has(manifest.serviceId)
        ? ("update" as const)
        : ("create" as const),
      manifest,
    };
  });

  return {
    canApply: issues.every((issue) => issue.severity !== "blocking"),
    items,
    issues,
  };
}

function validatePlacement(
  manifest: ServiceManifest,
  project: TenancyProject | undefined,
  existing: ServiceRegistryEntry | undefined,
  issues: RegistrationPlanIssue[],
) {
  if ((manifest.serviceType ?? "tribe") === "shared") return;

  if (!project) {
    issues.push({
      severity: "blocking",
      code: "project-missing",
      serviceId: manifest.serviceId,
      message: `Project '${manifest.projectId ?? ""}' must exist before '${manifest.serviceId}' can be registered.`,
    });
    return;
  }

  if (project.status !== "active") {
    issues.push({
      severity: "blocking",
      code: "project-inactive",
      serviceId: manifest.serviceId,
      message: `Project '${project.projectId}' is ${project.status}.`,
    });
  }

  if (existing?.projectId && existing.projectId !== project.projectId) {
    issues.push({
      severity: "blocking",
      code: "project-change",
      serviceId: manifest.serviceId,
      message: `'${manifest.serviceId}' belongs to project '${existing.projectId}'; services cannot move between projects.`,
    });
  }
}

function validateConsumes(
  manifest: ServiceManifest,
  existingById: Map<string, ServiceRegistryEntry>,
  batchById: Map<string, ServiceManifest>,
  mode: RegistrationMode,
  issues: RegistrationPlanIssue[],
) {
  for (const dependency of manifest.consumes) {
    if (isPlatformCapability(dependency)) {
      continue;
    }

    const exists = existingById.has(dependency) || batchById.has(dependency);
    if (!exists) {
      issues.push({
        severity: mode === "production-request" ? "blocking" : "warning",
        code: "unknown-consumed-service",
        serviceId: manifest.serviceId,
        message: `'${manifest.serviceId}' consumes '${dependency}', but that service is not registered in APICenter yet.`,
      });
    }
  }
}

function validateOperationalHints(
  manifest: ServiceManifest,
  issues: RegistrationPlanIssue[],
) {
  if (!manifest.exposes.includes("/health") && manifest.healthCheck !== "/health") {
    issues.push({
      severity: "warning",
      code: "missing-health-route",
      serviceId: manifest.serviceId,
      message: `'${manifest.serviceId}' should expose or configure /health for contract checks.`,
    });
  }

  if ((manifest.serviceType ?? "tribe") === "tribe") {
    issues.push({
      severity: "info",
      code: "service-credential",
      serviceId: manifest.serviceId,
      message: `Request tokens with APICENTER_SERVICE_ID='${manifest.serviceId}' and that service's own secret. Calls to other projects need a consumes grant.`,
    });
  }
}
