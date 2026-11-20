import { Module } from "@nestjs/common";
import { WhoAmIController } from "./whoami.controller";
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
import { WorkloadTokenVerifier } from "./workload-identity";
import { WorkloadBindingService } from "./workload-binding.service";
import { ApprovalsModule } from "@approvals/approvals.module";
import { OrganizationAdminController } from "./organization-admin.controller";
import { OrganizationAdminService } from "./organization-admin.service";
import { ApprovalsQueueController } from "./approvals-queue.controller";
import { ApprovalsQueueService } from "./approvals-queue.service";
import { MemberInviteService } from "./member-invite.service";
import { ObservabilityController } from "./observability/observability.controller";
import { ObservabilityService } from "./observability/observability.service";

/**
 * Control plane v2: organization-owned projects, environment-bound applications, explicit
 * grants, application credentials and console roles. See
 * docs/superpowers/specs/2026-11-14-control-plane-rebuild-design.md.
 * ApplicationAccessService is the public entry point for the request path.
 */
@Module({
  imports: [DatabaseModule, AuthModule, ApprovalsModule],
  controllers: [ControlPlaneAdminController, OrganizationAdminController, ApprovalsQueueController, WhoAmIController, ObservabilityController],
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
    WorkloadTokenVerifier,
    WorkloadBindingService,
    OrganizationAdminService,
    ApprovalsQueueService,
    MemberInviteService,
    ObservabilityService,
  ],
  exports: [ApplicationAccessService, ConsoleAccessService, ConsoleActorGuard, AuthModule],
})
export class ControlPlaneModule {}
