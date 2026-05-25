// =============================================================================
// src/shared-services/shared-services.module.ts — Shared Platform Services Module
// =============================================================================

import { Module } from "@nestjs/common";
import { SharedServicesController } from "./shared-services.controller";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { AuthModule } from "../auth/auth.module";
import { RegistryModule } from "../registry/registry.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { QuotasModule } from "../quotas/quotas.module";
import { PolicyEngineModule } from "../policy/policy-engine.module";
import { SharedServiceEventPublisher } from "./shared-service-event-publisher";

@Module({
  imports: [
    AuthModule,
    RegistryModule,
    AnalyticsModule,
    QuotasModule,
    PolicyEngineModule,
  ],
  controllers: [PaymentWebhookController, SharedServicesController],
  providers: [SharedServiceEventPublisher],
})
export class SharedServicesModule {}
