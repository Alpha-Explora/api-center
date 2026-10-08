import { Injectable } from "@nestjs/common";
import { RegistryService } from "./registry.service";
import { TenancyService } from "./tenancy.service";
import type {
  ProjectPlacement,
  ServicePlacement,
  TenancyDirectory,
  Tribe,
} from "./tenancy.types";

/** Implements the public TenancyDirectory port over the tenancy store and the service registry. */
@Injectable()
export class TenancyDirectoryService implements TenancyDirectory {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly registry: RegistryService,
  ) {}

  getTribe(tribeId: string): Tribe | null {
    return this.tenancy.getTribe(tribeId);
  }

  resolveProject(projectId: string): ProjectPlacement | null {
    return this.tenancy.resolveProject(projectId);
  }

  requireActiveProject(projectId: string | undefined): ProjectPlacement {
    return this.tenancy.requireActiveProject(projectId);
  }

  resolveServicePlacement(serviceId: string): ServicePlacement | null {
    const service = this.registry.get(serviceId);
    if (!service || (service.serviceType ?? "tribe") !== "tribe") return null;
    if (!service.projectId || !service.ownerTribeId) return null;
    return {
      serviceId: service.serviceId,
      projectId: service.projectId,
      tribeId: service.ownerTribeId,
    };
  }
}
