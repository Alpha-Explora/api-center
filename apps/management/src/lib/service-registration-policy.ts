import { getServiceEventTopics } from "@/lib/event-topics";
import { isPlatformCapability } from "@/lib/platform-capabilities";
import {
  serviceManifestSchema,
  type RegistrationPlanIssue,
  type ServiceManifest,
  type ServiceRegistrationPlan,
  type ServiceRegistryEntry,
} from "@/lib/schemas";

export type RegistrationMode = "local-direct" | "production-request";

export function buildServiceRegistrationPlan(input: {
  manifests: ServiceManifest[];
  existingServices: ServiceRegistryEntry[];
  mode: RegistrationMode;
}): ServiceRegistrationPlan {
  const manifests = input.manifests.map((manifest) =>
    serviceManifestSchema.parse(manifest),
  );
  const issues: RegistrationPlanIssue[] = [];
  const existingById = new Map(
    input.existingServices.map((service) => [service.serviceId, service]),
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
    const ownerTribeId = resolveOwnerTribeId(manifest);
    validateOwnerTribe(manifest, ownerTribeId, existingById, batchById, issues);
    validateConsumes(manifest, existingById, batchById, input.mode, issues);
    validateOperationalHints(manifest, ownerTribeId, issues);

    return {
      serviceId: manifest.serviceId,
      ownerTribeId,
      sourceServiceId: manifest.serviceId,
      eventTopic: getServiceEventTopics({
        serviceId: manifest.serviceId,
        ownerTribeId,
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

function resolveOwnerTribeId(manifest: ServiceManifest) {
  if ((manifest.serviceType ?? "tribe") === "shared") {
    return manifest.ownerTribeId ?? manifest.serviceId;
  }
  return manifest.ownerTribeId ?? manifest.serviceId;
}

function validateOwnerTribe(
  manifest: ServiceManifest,
  ownerTribeId: string,
  existingById: Map<string, ServiceRegistryEntry>,
  batchById: Map<string, ServiceManifest>,
  issues: RegistrationPlanIssue[],
) {
  if ((manifest.serviceType ?? "tribe") === "shared") return;
  if (ownerTribeId === manifest.serviceId) return;

  const existingOwner = existingById.get(ownerTribeId);
  const batchOwner = batchById.get(ownerTribeId);
  const ownerExists =
    Boolean(existingOwner && (existingOwner.serviceType ?? "tribe") !== "shared") ||
    batchOwner?.serviceType === "tribe";

  if (!ownerExists) {
    issues.push({
      severity: "blocking",
      code: "owner-tribe-missing",
      serviceId: manifest.serviceId,
      message: `Owner tribe '${ownerTribeId}' must exist before '${manifest.serviceId}' can be registered as its microservice.`,
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
  ownerTribeId: string,
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

  if (manifest.ownerTribeId && ownerTribeId !== manifest.serviceId) {
    issues.push({
      severity: "info",
      code: "microservice-attribution",
      serviceId: manifest.serviceId,
      message: `Use APICENTER_TRIBE_ID='${ownerTribeId}' and APICENTER_SERVICE_ID='${manifest.serviceId}'.`,
    });
  }
}
