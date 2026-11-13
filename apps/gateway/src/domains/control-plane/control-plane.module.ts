import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { AuthModule } from "@auth/auth.module";
import { ControlPlaneAdminController } from "./control-plane-admin.controller";
import { ControlPlaneAdminService } from "./control-plane-admin.service";
import { ApplicationAccessService } from "./application-access.service";
import { RuntimeContextSigner } from "./runtime-context.signer";

/**
 * Control plane v2: organization-owned projects, environment-bound applications, explicit
 * grants and application credentials. See docs/superpowers/specs/2026-11-14-control-plane-rebuild-design.md.
 * ApplicationAccessService is the public entry point for the request path.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ControlPlaneAdminController],
  providers: [ControlPlaneAdminService, ApplicationAccessService, RuntimeContextSigner],
  exports: [ApplicationAccessService],
})
export class ControlPlaneModule {}
