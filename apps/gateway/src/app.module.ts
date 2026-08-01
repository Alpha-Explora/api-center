// =============================================================================
// src/app.module.ts — Root Application Module
// =============================================================================
//
// FOUNDATION OVERVIEW (all 8 checklist sections map here):
//
//  §1  GATEWAY FOUNDATION
//        APICenter is the ONE gateway. Every route in this module tree
//        represents a centralized path — no tribe calls another tribe directly.
//
//  §2  3-CONTAINER SETUP
//        This module runs identically in api-center-1, api-center-2,
//        api-center-3. No container-specific branching. Stateless by design.
//
//  §3  LOAD BALANCING
//        NGINX sits in front (see nginx.conf). This module doesn't know or
//        care which container it is — any container serves any request.
//
//  §4  REQUEST FLOW:  consumer → NGINX → this module → upstream
//        ThrottlerModule  — rate-limit before touching business logic
//        AuthModule       — validate JWT before proxying
//        RegistryModule   — look up upstream URL
//        TribesModule     — proxy tribe-to-tribe calls
//        SharedServicesModule — proxy shared platform service calls
//        ExternalModule   — legacy external proxy namespace; no providers configured by default
//
//  §5 / §6  SDK
//        The shared SDK lives in the dedicated api-shared-services repository.
//        Tribes consume @implementsprint/sdk from the private registry, and it wraps
//        every namespace this module exposes.
//
//  §7  TRIBE CONSUMPTION
//        All tribe requests arrive via the SDK → NGINX → TribesModule.
//        No tribe calls another tribe's baseUrl directly.
//
//  §8  PRODUCTION RESILIENCE
//        Rate limiting uses Redis so counters are consistent across all 3
//        containers. Auth uses stateless JWTs. Registry is Redis-backed.
//        Any container can be stopped; the other two keep serving traffic.
//
//  CORS (required):
//        Configured in main.ts (app.enableCors). All proxy controllers also
//        inherit CORS headers because the global CORS configuration applies
//        to every route registered in this module tree.
// =============================================================================

import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";

import { ConfigModule } from "./config/config.module";
import { ConfigService } from "./config/config.service";
import { SharedModule } from "./shared/shared.module";
import { AuthModule } from "./domains/auth-security/auth/auth.module";
import { RegistryModule } from "./domains/catalog-registry/registry/registry.module";
import { TribesModule } from "./domains/gateway-proxy/tribes/tribes.module";
import { ExternalModule } from "./domains/gateway-proxy/external/external.module";
import { SharedServicesModule } from "./domains/gateway-proxy/shared-services/shared-services.module";
import { HealthModule } from "./domains/runtime-ops/health/health.module";
import { MetricsModule } from "./metrics/metrics.module";
import { AnalyticsModule } from "./domains/runtime-ops/analytics/analytics.module";
import { GovernanceModule } from "@governance";
import { CatalogModule } from "./domains/catalog-registry/catalog/catalog.module";
import { ComplianceModule } from "./domains/compliance/compliance/compliance.module";
import { ForecastingModule } from "./domains/runtime-ops/forecasting/forecasting.module";
import { OperationsModule } from "./domains/runtime-ops/operations/operations.module";
import { CapabilitiesModule } from "./domains/runtime-ops/capabilities/capabilities.module";
import { PaymentsModule } from "./domains/payments/payments/payments.module";

import { SecurityMiddleware } from "./shared/middleware/security.middleware";
import { MorganMiddleware } from "./shared/middleware/morgan.middleware";
import { ResponseListenerBudgetMiddleware } from "./shared/middleware/response-listener-budget.middleware";
import { RedisThrottlerStorage } from "./shared/redis-throttler-storage";
import { TribeThrottlerGuard } from "./shared/guards/tribe-throttler.guard";

@Module({
  imports: [
    // ── 1. Configuration — loaded first, all other modules depend on it ──────
    ConfigModule,

    // ── 2. Distributed rate limiting ─────────────────────────────────────────
    // Because all 3 containers share Redis, rate-limit counters are consistent
    // across the entire gateway fleet — not just per-container.
    // ALLOWED_ORIGINS / rate-limit window / max are driven by env vars.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, SharedModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService, storage: RedisThrottlerStorage) => ({
        throttlers: [
          { ttl: config.rateLimit.windowMs, limit: config.rateLimit.max },
        ],
        storage,
      }),
    }),

    // ── 3. Shared utilities — @Global, available everywhere without re-import ─
    SharedModule, // LoggerService, AllExceptionsFilter, interceptors, middleware

    // ── 4. Observability & Bounded Contexts ──────────────────────────────────
    MetricsModule, // Prometheus counters / histograms / gauges
    AnalyticsModule, // Protected JSON analytics for the management console
    GovernanceModule, // Complete governance bounded context (quotas, entitlements, approvals, policy, dev portal)
    ForecastingModule, // Quota pressure projections
    OperationsModule, // Drift, dependencies, evidence, emergency, scorecards
    CatalogModule, // API marketplace product projection
    ComplianceModule, // Audit-ready export packets
    CapabilitiesModule, // Runtime capability snapshot for management and operators
    PaymentsModule, // Provider-neutral payments facade backed by private apps/payments

    // ── 5. Infrastructure services ────────────────────────────────────────────
    AuthModule, // JWT providers + Vault + TokenStore — guards every proxy

    // ── 6. Service registry ───────────────────────────────────────────────────
    // The registry is the source of truth for which services exist and where
    // they live. Stored in Redis so all 3 containers see the same picture.
    // Tribes register via POST /api/v1/registry/register — no static config.
    RegistryModule,

    // ── 7. Gateway routing — the three centralized proxy namespaces ───────────
    //
    // TRIBE-TO-TRIBE  →  /api/v1/tribes/:serviceId/*
    //   All inter-tribe calls pass through here.
    //   Tribes MUST use the SDK (TribeClient.callService) — no direct calls.
    //   JwtAuthGuard + scope checks enforced on every request.
    TribesModule,

    // SHARED PLATFORM SERVICES  →  /api/v1/shared/:serviceId/*
    //   Platform-owned shared services (email, SMS, payments, notifications).
    //   Registered with serviceType:'shared'.
    //   SDK: TribeClient.callSharedService(...)
    SharedServicesModule,

    // LEGACY EXTERNAL PROXY  →  /api/v1/external/:apiName/*
    //   Kept as a guarded namespace, but no providers are configured by default.
    //   New provider-backed integrations should be shared services plus SDK
    //   wrappers, or governed Kafka routes for event publishing.
    ExternalModule,

    // ── 8. Health ─────────────────────────────────────────────────────────────
    // /api/v1/health/live  — liveness probe (NGINX + k8s readiness gate)
    // /api/v1/health/ready — readiness probe (checks Kafka, registry, breakers)
    HealthModule,
  ],
  providers: [
    // TribeThrottlerGuard enforces per-tribe rate limits on every route.
    // Using Redis storage means all 3 containers share the same counters.
    { provide: APP_GUARD, useClass: TribeThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  // Express-level middleware runs BEFORE NestJS guards / interceptors / pipes.
  // SecurityMiddleware strips sensitive response headers and enforces payload limits.
  // MorganMiddleware logs incoming HTTP requests to the Winston stream.
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        ResponseListenerBudgetMiddleware,
        SecurityMiddleware,
        MorganMiddleware,
      )
      .forRoutes("{*splat}");
  }
}
