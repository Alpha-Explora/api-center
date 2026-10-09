import { Inject, Injectable } from "@nestjs/common";
import {
  REGISTRY_CHANGE_REQUEST_STORE,
  RegistryChangeRequestRecord,
  RegistryChangeRequestStore,
} from "@change-requests/registry-change-request.types";
import { ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { isPlatformCapability } from "@shared/platform-capabilities";
import { ServiceManifest } from "../../../types";
import { RegistryService } from "./registry.service";
import { TenancyService } from "./tenancy.service";

type RegistrationRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied";

export type RegistrationPlanIssue = {
  severity: "info" | "warning" | "blocking";
  code: string;
  serviceId?: string;
  message: string;
};

export type RegistrationValidationReport = {
  canApply: boolean;
  issues: RegistrationPlanIssue[];
};

export type ServiceRegistrationRequest = {
  id: string;
  serviceId: string;
  /** Derived from projectId; null for shared services. */
  ownerTribeId: string | null;
  projectId: string | null;
  status: string;
  manifest: ServiceManifest;
  validationReport: RegistrationValidationReport;
  requestedBy?: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  appliedServiceId?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  appliedAt?: string;
};

@Injectable()
export class RegistrationRequestsService {
  constructor(
    @Inject(REGISTRY_CHANGE_REQUEST_STORE)
    private readonly requests: RegistryChangeRequestStore,
    private readonly registry: RegistryService,
    private readonly tenancy: TenancyService,
  ) {}

  async createRequest(input: {
    manifest: ServiceManifest;
    requestedBy?: string;
  }): Promise<ServiceRegistrationRequest> {
    const manifest = normalizeManifest(input.manifest);
    await this.tenancy.refreshIfMissing(manifest.projectId);
    const placement = this.resolveRequestPlacement(manifest);
    const validationReport = this.buildValidationReport(manifest);
    const row = await this.requests.create({
      serviceId: manifest.serviceId,
      ownerTribeId: placement?.tribeId ?? null,
      projectId: placement?.projectId ?? null,
      manifest,
      validationReport,
      requestedBy: input.requestedBy,
    });

    return mapRow(row);
  }

  async listRequests(
    status?: RegistrationRequestStatus,
  ): Promise<ServiceRegistrationRequest[]> {
    const rows = await this.requests.list(status);

    return rows.map(mapRow);
  }

  async approveRequest(
    requestId: string,
    approvedBy: string,
  ): Promise<ServiceRegistrationRequest> {
    const request = await this.getRequest(requestId);
    if (request.status !== "pending") {
      throw new ConflictError(
        "Only pending registration requests can be approved",
      );
    }

    const manifest = normalizeManifest(request.manifest);
    await this.tenancy.refreshIfMissing(manifest.projectId);
    const validationReport = this.buildValidationReport(manifest);

    if (!validationReport.canApply) {
      await this.requests.saveValidationReport(requestId, validationReport);

      const blockingMessages = validationReport.issues
        .filter((issue) => issue.severity === "blocking")
        .map((issue) => issue.message)
        .join(" ");

      throw new ConflictError(
        `Registration request cannot be approved: ${blockingMessages}`,
      );
    }

    const entry = await this.registry.register(manifest);
    const row = await this.requests.markApplied(requestId, {
      approvedBy,
      appliedServiceId: entry.serviceId,
      validationReport,
    });

    return mapRow(row);
  }

  async rejectRequest(
    requestId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<ServiceRegistrationRequest> {
    const rejected = await this.requests.rejectIfPending(requestId, {
      rejectedBy,
      reason,
    });

    if (!rejected) {
      throw new ConflictError(
        "Only pending registration requests can be rejected",
      );
    }

    return this.getRequest(requestId);
  }

  private async getRequest(
    requestId: string,
  ): Promise<ServiceRegistrationRequest> {
    const row = await this.requests.find(requestId);

    if (!row) {
      throw new NotFoundError(`Registration request '${requestId}' not found`);
    }

    return mapRow(row);
  }

  /** Tribe services must target a registered project; shared services have no placement. */
  private resolveRequestPlacement(
    manifest: ServiceManifest,
  ): { projectId: string; tribeId: string } | null {
    if ((manifest.serviceType ?? "tribe") === "shared") return null;
    if (!manifest.projectId) {
      throw new ValidationError("projectId is required for tribe services");
    }
    const placement = this.tenancy.resolveProject(manifest.projectId);
    if (!placement) {
      throw new ValidationError(`Project '${manifest.projectId}' is not registered`);
    }
    return { projectId: placement.project.projectId, tribeId: placement.tribe.tribeId };
  }

  private buildValidationReport(manifest: ServiceManifest): RegistrationValidationReport {
    const registry = this.registry.getAll();
    const issues: RegistrationPlanIssue[] = [];

    if ((manifest.serviceType ?? "tribe") !== "shared") {
      const placement = manifest.projectId
        ? this.tenancy.resolveProject(manifest.projectId)
        : null;
      if (!placement) {
        issues.push({
          severity: "blocking",
          code: "project-missing",
          serviceId: manifest.serviceId,
          message: `Project '${manifest.projectId ?? ""}' must exist before '${manifest.serviceId}' can be registered.`,
        });
      } else if (placement.tribe.status !== "active" || placement.project.status !== "active") {
        issues.push({
          severity: "blocking",
          code: "project-inactive",
          serviceId: manifest.serviceId,
          message: `Project '${placement.project.projectId}' (${placement.project.status}) in tribe '${placement.tribe.tribeId}' (${placement.tribe.status}) must be active.`,
        });
      }

      const existing = registry[manifest.serviceId];
      if (existing?.projectId && existing.projectId !== manifest.projectId) {
        issues.push({
          severity: "blocking",
          code: "project-change",
          serviceId: manifest.serviceId,
          message: `'${manifest.serviceId}' belongs to project '${existing.projectId}'; services cannot move between projects.`,
        });
      }
    }

    for (const dependency of manifest.consumes ?? []) {
      if (isPlatformCapability(dependency)) {
        continue;
      }

      if (!registry[dependency]) {
        issues.push({
          severity: "warning",
          code: "unknown-consumed-service",
          serviceId: manifest.serviceId,
          message: `'${manifest.serviceId}' consumes '${dependency}', but that service is not registered yet.`,
        });
      }
    }

    return {
      canApply: issues.every((issue) => issue.severity !== "blocking"),
      issues,
    };
  }
}

function normalizeManifest(manifest: ServiceManifest): ServiceManifest {
  const normalized: ServiceManifest & { ownerTribeId?: unknown } = {
    ...manifest,
    consumes: manifest.consumes ?? [],
    serviceType: manifest.serviceType ?? "tribe",
  };
  // Shared platform services have no tribe. Requests stored before the hierarchy may still carry one.
  if (normalized.serviceType === "shared") delete normalized.ownerTribeId;
  return normalized;
}

function mapRow(row: RegistryChangeRequestRecord): ServiceRegistrationRequest {
  return {
    id: row.id,
    serviceId: row.serviceId,
    ownerTribeId: row.ownerTribeId,
    projectId: row.projectId,
    status: row.status as RegistrationRequestStatus,
    manifest: parseJsonField<ServiceManifest>(row.manifest),
    validationReport: parseJsonField<RegistrationValidationReport>(
      row.validationReport,
    ),
    requestedBy: row.requestedBy ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    rejectedBy: row.rejectedBy ?? undefined,
    rejectionReason: row.rejectionReason ?? undefined,
    appliedServiceId: row.appliedServiceId ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    decidedAt: row.decidedAt ? toIsoString(row.decidedAt) : undefined,
    appliedAt: row.appliedAt ? toIsoString(row.appliedAt) : undefined,
  };
}

function parseJsonField<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
