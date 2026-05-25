import { Controller, Get, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { RegistryService } from "../registry/registry.service";
import { ConsumerScorecardService } from "./consumer-scorecard.service";

@Controller("admin/operations/scorecards")
@UseGuards(ScopedAdminGuard)
export class ConsumerScorecardController {
  constructor(
    private readonly registry: RegistryService,
    private readonly scorecards: ConsumerScorecardService,
  ) {}

  @Get()
  list() {
    const latestSdkVersion =
      process.env.APICENTER_SDK_CONTRACT_VERSION ?? "1.2.1";
    const data = Object.values(this.registry.getAll()).map((service) =>
      this.scorecards.score({
        ownerTribeId: service.ownerTribeId ?? service.serviceId,
        sdkVersion: service.version ?? "unknown",
        latestSdkVersion,
        quotaUsagePercent: 0,
        errorRatePercent: 0,
      }),
    );

    return { success: true, data };
  }
}
