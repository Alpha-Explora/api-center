import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { AuthModule } from "@auth/auth.module";
import { ControlPlaneAdminController } from "./control-plane-admin.controller";
import { ControlPlaneAdminService } from "./control-plane-admin.service";
import { ApplicationAccessService } from "./application-access.service";
import { RuntimeContextSigner } from "./runtime-context.signer";
import { ConsoleAccessService } from "./console-access.service";
import { OrganizationPeopleService } from "./organization-people.service";
import { ConsoleActorGuard } from "./console-actor.guard";
import { QuotaService } from "./quota.service";
import { LiveEnvironmentService } from "./live-environment.service";
import { CapabilityConfigurationService } from "./capability-configuration.service";
import { PublishedApiService } from "./published-api.service";
import { ApprovalsModule } from "@approvals/approvals.module";

/**
 * Control plane v2: organization-owned projects, environment-bound applications, explicit
 * grants, application credentials and console roles. See
 * docs/superpowers/specs/2026-11-14-control-plane-rebuild-design.md.
 * ApplicationAccessService is the public entry point for the request path.
 */
@Module({
  imports: [DatabaseModule, AuthModule, ApprovalsModule],
  controllers: [ControlPlaneAdminController],
  providers: [
    ControlPlaneAdminService,
    ApplicationAccessService,
    RuntimeContextSigner,
    ConsoleAccessService,
    OrganizationPeopleService,
    ConsoleActorGuard,
    QuotaService,
    LiveEnvironmentService,
    CapabilityConfigurationService,
    PublishedApiService,
  ],
  exports: [ApplicationAccessService],
})
export class ControlPlaneModule {}
