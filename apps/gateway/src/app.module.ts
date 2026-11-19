// =============================================================================
// Root module of the APICenter gateway.
//
// Callers are applications with keys (ak_test_/ak_live_) or Google workload identities. The
// control plane authenticates them, checks their grants, quotas and budgets, and forwards calls to
// the capability runtimes (/api/v1/shared/:capability/*), the payments facade (/api/v1/payments/*)
// or published APIs (/api/v1/apis/:apiId/*) with a signed runtime context. The management console
// and operator scripts use the admin routes with the platform credential, acting as the signed-in
// person where the console forwards one.
// =============================================================================

import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ConfigModule } from "./config/config.module";
import { ConfigService } from "./config/config.service";
import { SharedModule } from "./shared/shared.module";
import { SharedServicesModule } from "./domains/gateway-proxy/shared-services/shared-services.module";
import { HealthModule } from "./domains/runtime-ops/health/health.module";
import { DiagnosticsModule } from "./domains/runtime-ops/diagnostics/diagnostics.module";
import { MetricsModule } from "./metrics/metrics.module";
import { AuditModule } from "./domains/compliance/audit/audit.module";
import { ApprovalsModule } from "./domains/governance/approvals/approvals.module";
import { PaymentsModule } from "./domains/payments/payments.module";
import { ControlPlaneModule } from "./domains/control-plane/control-plane.module";
import { PublishedApisModule } from "./domains/gateway-proxy/published-apis/published-apis.module";
import { EventDestinationsModule } from "./domains/control-plane/event-destinations/event-destinations.module";
import { SecurityMiddleware } from "./shared/middleware/security.middleware";
import { RequestDiagnosticsMiddleware } from "./shared/middleware/request-diagnostics.middleware";
import { MorganMiddleware } from "./shared/middleware/morgan.middleware";
import { ResponseListenerBudgetMiddleware } from "./shared/middleware/response-listener-budget.middleware";
import { MemoryThrottlerStorage } from "./shared/memory-throttler-storage";
import { CallerThrottlerGuard } from "./shared/guards/caller-throttler.guard";

@Module({
  imports: [
    ConfigModule,
    // Per-instance request rate limits in front of everything else. Budgets and quotas per
    // environment are enforced by the control plane in Postgres.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, SharedModule],
      inject: [ConfigService, MemoryThrottlerStorage],
      useFactory: (config: ConfigService, storage: MemoryThrottlerStorage) => ({
        throttlers: [{ ttl: config.rateLimit.windowMs, limit: config.rateLimit.max }],
        storage,
      }),
    }),
    SharedModule,
    MetricsModule,
    AuditModule,
    ApprovalsModule,
    ControlPlaneModule,
    EventDestinationsModule,
    SharedServicesModule,
    PaymentsModule,
    PublishedApisModule,
    DiagnosticsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: CallerThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Express middleware runs before Nest guards, interceptors and pipes.
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ResponseListenerBudgetMiddleware, RequestDiagnosticsMiddleware, SecurityMiddleware, MorganMiddleware)
      .forRoutes("{*splat}");
  }
}
