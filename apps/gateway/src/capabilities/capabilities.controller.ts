import { Controller, Get, UseGuards } from "@nestjs/common";
import { PlatformAdminGuard } from "../auth/guards/platform-admin.guard";
import { CapabilitiesService } from "./capabilities.service";

@Controller("capabilities")
@UseGuards(PlatformAdminGuard)
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilitiesService) {}

  @Get()
  getCapabilities() {
    return {
      success: true,
      data: this.capabilities.snapshot(),
    };
  }
}
