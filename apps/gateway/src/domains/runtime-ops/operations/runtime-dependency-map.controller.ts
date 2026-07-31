import { Controller, Get, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { RegistryService } from "@registry/registry.service";
import { RuntimeDependencyMapService } from "./runtime-dependency-map.service";

@Controller("admin/operations/dependencies")
@UseGuards(ScopedAdminGuard)
export class RuntimeDependencyMapController {
  constructor(
    private readonly registry: RegistryService,
    private readonly dependencies: RuntimeDependencyMapService,
  ) {}

  @Get()
  getMap() {
    const services = Object.values(this.registry.getAll());
    const topics = services
      .filter((service) => service.consumes?.includes("kafka"))
      .map((service) => ({
        ownerTribeId: service.ownerTribeId ?? service.serviceId,
        topicName: `tribe.${service.ownerTribeId ?? service.serviceId}.events`,
      }));

    return {
      success: true,
      data: this.dependencies.build({ services, topics }),
    };
  }
}
