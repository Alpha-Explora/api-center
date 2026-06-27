// =============================================================================
// src/shared/proxy-handler.ts — Reusable proxy utility
// =============================================================================
// Extracted from TribesController so both /tribes/* and /shared/* controllers
// can compose the same proxy creation, lifecycle gating, scope checking, and
// metrics recording without code duplication.
//
// RESILIENCE:
//  - Per-service CircuitBreaker: rejects requests fast when upstreams fail.
//  - Hard proxyTimeout (30 s): prevents slow upstreams from exhausting connections.
//  - Cache invalidation: stale proxy instances are dropped on re-registration.
// =============================================================================

import { Response } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Options, RequestHandler } from "http-proxy-middleware";
import { RegistryService } from "../registry/registry.service";
import { AuthService } from "../auth/auth.service";
import { LoggerService } from "../shared/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { AuditEventsService } from "../analytics/audit-events.service";
import { GatewayTrafficService } from "../analytics/gateway-traffic.service";
import { SharedServiceUsageService } from "../analytics/shared-service-usage.service";
import {
  ServiceCallObservation,
  ServiceCallOutcome,
} from "../analytics/service-call-observation";
import { SharedServiceEventPublisher } from "../shared-services/shared-service-event-publisher";
import { EmergencyControlService } from "../operations/emergency-control.service";
import { TribeQuotaEnforcerService } from "../quotas/tribe-quota-enforcer.service";
import { PolicyEngineService } from "../policy/policy-engine.service";
import { PolicyRuleExplanation } from "../policy/policy-rule.types";
import { CircuitBreaker } from "../shared/circuit-breaker";
import {
  ForbiddenError,
  NotFoundError,
  BadGatewayError,
  ServiceUnavailableError,
} from "../shared/errors";
import { requireGovernanceDependency } from "../shared/governance-dependencies";
import {
  ApicenterRuntimeEnvironment,
  AuthenticatedRequest,
  ServiceType,
} from "../types";
import { enforceProxyAuthContext } from "./proxy/proxy-auth-context";
import {
  assertNoEnvironmentOverrides,
  enforceEnvironmentAccess,
  stripApicenterIdentityHeaders,
} from "./proxy/environment-leak-guard";
import { checkProxyQuota } from "./proxy/proxy-quota-context";
import { createUpstreamProxyOptions } from "./proxy/upstream-request";
import type { SharedServiceRoutingService } from "../shared-services/shared-service-routing.service";

/** Default hard timeout for outgoing proxy requests (ms). */
const PROXY_TIMEOUT_MS = 30_000;

/** Maximum number of cached proxy middleware instances. */
const MAX_PROXY_CACHE_SIZE = 200;

/** Maximum upstream response body bytes captured for sanitized event export. */
const MAX_CAPTURED_RESPONSE_BYTES = 64_000;

/** HTTP 410 Gone — service has been retired */
export class GoneError extends NotFoundError {
  constructor(message: string) {
    super(message);
    Object.defineProperty(this, "status", { value: 410 });
  }
}

function attachJsonResponseCapture(res: Response): { getBody: () => unknown } {
  const response = res as unknown as {
    write?: (...args: unknown[]) => unknown;
    end?: (...args: unknown[]) => unknown;
  };

  if (
    typeof response.write !== "function" ||
    typeof response.end !== "function"
  ) {
    return { getBody: () => undefined };
  }

  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  const originalWrite = response.write.bind(res);
  const originalEnd = response.end.bind(res);

  response.write = (...args: unknown[]) => {
    captureChunk(args[0]);
    return originalWrite(...args);
  };

  response.end = (...args: unknown[]) => {
    captureChunk(args[0]);
    return originalEnd(...args);
  };

  return {
    getBody: () => {
      if (truncated || chunks.length === 0) {
        return undefined;
      }

      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return undefined;
      }
    },
  };

  function captureChunk(chunk: unknown) {
    if (chunk === undefined || chunk === null || typeof chunk === "function") {
      return;
    }

    let buffer: Buffer | undefined;
    if (Buffer.isBuffer(chunk)) {
      buffer = chunk;
    } else if (chunk instanceof Uint8Array) {
      buffer = Buffer.from(chunk);
    } else if (typeof chunk === "string") {
      buffer = Buffer.from(chunk);
    }

    if (!buffer) {
      return;
    }

    capturedBytes += buffer.length;
    if (capturedBytes > MAX_CAPTURED_RESPONSE_BYTES) {
      truncated = true;
      chunks.length = 0;
      return;
    }

    chunks.push(buffer);
  }
}

export interface ProxyHandlerDeps {
  registry: RegistryService;
  /** Provider-agnostic auth service (replaces DescopeService) */
  auth: AuthService;
  logger: LoggerService;
  metrics: MetricsService;
  auditEvents?: AuditEventsService;
  gatewayTraffic?: GatewayTrafficService;
  sharedServiceUsage?: SharedServiceUsageService;
  sharedServiceEvents?: SharedServiceEventPublisher;
  sharedServiceRouting?: Pick<SharedServiceRoutingService, "resolve">;
  quotaEnforcer: TribeQuotaEnforcerService;
  policyEngine: PolicyEngineService;
  emergencyControls: EmergencyControlService;
}

export interface ProxyOptions {
  /** Route namespace for this proxy — 'shared' or 'tribe' */
  namespace: ServiceType;
  /** The URL prefix to strip, e.g. '/api/v1/tribes' or '/api/v1/shared' */
  pathPrefix: string;
  /** Outgoing proxy timeout in ms (default: 30 000) */
  proxyTimeoutMs?: number;
  /** Max number of cached proxy middleware instances (default: 200). */
  maxProxyCacheSize?: number;
}

type ProxyMiddleware = RequestHandler<IncomingMessage, ServerResponse>;
type CreateProxyMiddleware = (
  options: Options<IncomingMessage, ServerResponse>,
) => ProxyMiddleware;

let cachedCreateProxyMiddleware: CreateProxyMiddleware | undefined;
let testCreateProxyMiddleware: CreateProxyMiddleware | undefined;

export function setCreateProxyMiddlewareForTesting(
  factory: CreateProxyMiddleware | undefined,
): void {
  testCreateProxyMiddleware = factory;
  cachedCreateProxyMiddleware = undefined;
}

async function loadCreateProxyMiddleware(): Promise<CreateProxyMiddleware> {
  if (testCreateProxyMiddleware) {
    return testCreateProxyMiddleware;
  }
  if (cachedCreateProxyMiddleware) {
    return cachedCreateProxyMiddleware;
  }

  // http-proxy-middleware v4 is ESM-only. TypeScript rewrites dynamic import
  // to require() in CommonJS output, so keep native import() via Function.
  const nativeImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<typeof import("http-proxy-middleware")>;
  const mod = await nativeImport("http-proxy-middleware");
  cachedCreateProxyMiddleware =
    mod.createProxyMiddleware as CreateProxyMiddleware;
  return cachedCreateProxyMiddleware;
}

/**
 * Reusable proxy handler that both TribesController and SharedServicesController
 * compose for dynamic upstream proxying with lifecycle gating, scope checks,
 * per-service circuit breakers, and cache invalidation.
 */
export class ProxyHandler {
  private readonly proxyCache = new Map<string, ProxyMiddleware>();
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly proxyTimeoutMs: number;
  private readonly maxProxyCacheSize: number;
  private readonly unsubscribeCacheInvalidation: () => void;

  constructor(
    private readonly deps: ProxyHandlerDeps,
    private readonly opts: ProxyOptions,
  ) {
    this.proxyTimeoutMs = opts.proxyTimeoutMs ?? PROXY_TIMEOUT_MS;
    this.maxProxyCacheSize = opts.maxProxyCacheSize ?? MAX_PROXY_CACHE_SIZE;

    // Subscribe to registry re-registration events so stale proxy instances
    // are dropped automatically when a service's baseUrl changes.
    this.unsubscribeCacheInvalidation = deps.registry.onCacheInvalidation(
      (serviceId) => this.invalidateProxyCache(serviceId),
    );
  }

  /** Clear the entire proxy cache and circuit breakers (call from onModuleDestroy). */
  destroy(): void {
    this.unsubscribeCacheInvalidation();
    this.proxyCache.clear();
    this.circuitBreakers.clear();
  }

  /**
   * Remove the cached proxy middleware for a specific service so the next
   * request creates a fresh instance pointing at the latest baseUrl.
   */
  invalidateProxyCache(serviceId: string): void {
    let existed = this.proxyCache.delete(serviceId);
    for (const cacheKey of [...this.proxyCache.keys()]) {
      if (cacheKey.startsWith(`${serviceId}:`)) {
        this.proxyCache.delete(cacheKey);
        existed = true;
      }
    }
    let breakerDeleted = this.circuitBreakers.delete(serviceId);
    for (const cacheKey of [...this.circuitBreakers.keys()]) {
      if (cacheKey.startsWith(`${serviceId}:`)) {
        this.circuitBreakers.delete(cacheKey);
        breakerDeleted = true;
      }
    }
    if (existed || breakerDeleted) {
      this.deps.logger.info(`Proxy cache invalidated for '${serviceId}'`, {
        serviceId,
        namespace: this.opts.namespace,
      });
    }
  }

  /**
   * List services visible to a caller, filtered by this handler's namespace.
   */
  listServices(tribeId: string | undefined, includeNonConsumable = false) {
    const services = this.deps.registry.getByType(this.opts.namespace);

    const visibleServices = services
      .filter((svc) => svc.status !== "retired")
      .map((svc) => ({
        canAccess: tribeId
          ? this.deps.registry.canAccess(tribeId, svc.serviceId)
          : false,
        serviceId: svc.serviceId,
        name: svc.name,
        status: svc.status,
        version: svc.version,
        exposes: svc.exposes,
        requiredScopes: svc.requiredScopes,
        serviceType: svc.serviceType ?? "tribe",
        ...(svc.status === "deprecated" && {
          deprecated: true,
          sunsetDate: svc.sunsetDate,
          replacementService: svc.replacementService,
        }),
      }))
      .filter((svc) => includeNonConsumable || svc.canAccess);

    this.deps.metrics.recordServiceDiscoverySnapshot(
      this.opts.namespace,
      tribeId ? "authenticated" : "anonymous",
      visibleServices.map((service) => service.status),
    );

    return visibleServices;
  }

  /**
   * Proxy a request to a registered upstream service.
   * Validates namespace, lifecycle status, scope constraints, then forwards.
   */
  async proxyRequest(
    targetServiceId: string,
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const tribeId = req.tribeId!;
    const correlationId = req.correlationId;

    // 1. Resolve upstream from the validated token environment only.
    const targetEntry = this.deps.registry.get(targetServiceId);
    if (!targetEntry) {
      throw new NotFoundError(
        `Service '${targetServiceId}' not found or inactive`,
      );
    }

    const targetEnvironment = this.resolveTargetEnvironment(req);
    const upstream = this.resolveUpstreamForEnvironment(
      targetServiceId,
      targetEnvironment,
      targetEntry,
    );
    stripApicenterIdentityHeaders(
      req.headers as Record<string, unknown> | undefined,
    );

    // 1b. Validate namespace
    const targetType = targetEntry?.serviceType ?? "tribe";
    if (targetType !== this.opts.namespace) {
      const correctPrefix = targetType === "shared" ? "/shared/" : "/tribes/";
      throw new NotFoundError(
        `Service '${targetServiceId}' is a ${targetType} service. Use ${correctPrefix}${targetServiceId} instead.`,
      );
    }

    // ── 1c. Lifecycle gate ─────────────────────────────────────────────────
    this.enforceLifecycleGate(targetEntry, targetServiceId, res);
    this.enforcePolicyRules(targetEntry, req, res);

    // ── 2. Scope check ─────────────────────────────────────────────────────
    enforceProxyAuthContext({
      registry: this.deps.registry,
      auth: this.deps.auth,
      emergencyControls: this.deps.emergencyControls,
      targetServiceId,
      tribeId,
      req,
    });

    // ── 3. Circuit-breaker gate ────────────────────────────────────────────
    await checkProxyQuota({
      quotaEnforcer: this.deps.quotaEnforcer,
      ownerTribeId: tribeId,
      namespace: this.opts.namespace,
      targetServiceId,
      correlationId,
      environment: targetEnvironment,
    });

    const routeRuntimeKey = `${targetServiceId}:${targetEnvironment}`;
    const breaker = this.getOrCreateCircuitBreaker(routeRuntimeKey);
    if (!breaker.tryAcquire()) {
      this.deps.logger.warn(
        `Circuit breaker OPEN for '${targetServiceId}' — rejecting request`,
        "ProxyHandler",
      );
      throw new ServiceUnavailableError(
        `Upstream '${targetServiceId}' is temporarily unavailable (circuit breaker open)`,
      );
    }

    // ── 4. Get or create proxy ─────────────────────────────────────────────
    const proxyCacheKey = routeRuntimeKey;
    let proxy = this.proxyCache.get(proxyCacheKey);

    if (!proxy) {
      this.evictOldestProxyEntryIfNeeded();

      const proxyOpts = createUpstreamProxyOptions({
        targetServiceId,
        targetEnvironment,
        upstream,
        namespace: this.opts.namespace,
        pathPrefix: this.opts.pathPrefix,
        proxyTimeoutMs: this.proxyTimeoutMs,
        correlationId,
        circuitBreakers: this.circuitBreakers,
        logger: this.deps.logger,
      });
      const createProxyMiddleware = await loadCreateProxyMiddleware();
      const createdProxy = createProxyMiddleware(proxyOpts) as ProxyMiddleware;
      proxy = createdProxy;
      this.proxyCache.set(proxyCacheKey, createdProxy);

      this.deps.logger.info("Created proxy instance", {
        targetServiceId,
        targetEnvironment,
        upstream,
        namespace: this.opts.namespace,
        proxyTimeoutMs: this.proxyTimeoutMs,
        correlationId,
      });
    }

    // ── 5. Forward the request ─────────────────────────────────────────────
    const proxyStart = Date.now();
    const responseCapture = attachJsonResponseCapture(res);

    res.on("finish", () => {
      const latencyMs = Date.now() - proxyStart;
      const durationSec = latencyMs / 1000;
      const observation = this.buildServiceCallObservation({
        tribeId,
        targetServiceId,
        targetEnvironment,
        req,
        statusCode: res.statusCode,
        latencyMs,
      });
      this.deps.metrics.recordProxyRequest(
        this.opts.namespace,
        tribeId,
        targetServiceId,
        req.method,
        res.statusCode,
        durationSec,
      );
      this.recordGatewayTraffic(observation, req);
      this.recordSharedServiceUsage(observation, req);
      this.publishSharedServiceExportEvent(
        tribeId,
        targetServiceId,
        req,
        res.statusCode,
        latencyMs,
        responseCapture.getBody(),
      );
    });

    try {
      await proxy(req, res as unknown as ServerResponse, (err?: Error) => {
        if (err) {
          this.deps.logger.error(
            `Proxy callback error [${targetServiceId}]: ${err.message}`,
          );
          throw new BadGatewayError(
            `Upstream '${targetServiceId}' unreachable`,
          );
        }
      });
    } catch (error: any) {
      this.deps.logger.error(
        `Proxy throw error [${targetServiceId}]: ${error.message}`,
      );
      throw new BadGatewayError(`Upstream '${targetServiceId}' unreachable`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private resolveUpstreamForEnvironment(
    targetServiceId: string,
    targetEnvironment: ApicenterRuntimeEnvironment,
    targetEntry: ReturnType<RegistryService["get"]>,
  ): string {
    if (this.opts.namespace === "shared" && this.deps.sharedServiceRouting) {
      return this.deps.sharedServiceRouting.resolve(
        targetServiceId,
        targetEnvironment,
      ).targetUrl;
    }

    const resolvedEnvironment = this.deps.registry.resolveEnvironment?.(
      targetServiceId,
      targetEnvironment,
    );
    const configuredEnvironments = targetEntry?.environments ?? [];
    const serviceEnvironment = enforceEnvironmentAccess({
      callerEnvironment: targetEnvironment,
      target: {
        serviceId: targetServiceId,
        environments:
          configuredEnvironments.length > 0
            ? configuredEnvironments
            : resolvedEnvironment
              ? [resolvedEnvironment]
              : [],
      },
    });

    return serviceEnvironment.baseUrl;
  }
  /** Return the existing circuit breaker for a service, or create a new one. */
  private getOrCreateCircuitBreaker(serviceId: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(serviceId);
    if (!breaker) {
      breaker = new CircuitBreaker(`proxy:${serviceId}`, this.deps.logger, {
        failureThreshold: 5,
        resetTimeoutMs: 30_000,
        successThreshold: 2,
      });
      this.circuitBreakers.set(serviceId, breaker);
    }
    return breaker;
  }

  private evictOldestProxyEntryIfNeeded(): void {
    if (this.proxyCache.size < this.maxProxyCacheSize) {
      return;
    }

    const oldestServiceId = this.proxyCache.keys().next().value as
      | string
      | undefined;
    if (!oldestServiceId) {
      return;
    }

    this.proxyCache.delete(oldestServiceId);
    this.circuitBreakers.delete(oldestServiceId);

    this.deps.logger.warn(
      `Proxy cache size limit reached (${this.maxProxyCacheSize}); evicted oldest proxy '${oldestServiceId}'`,
      "ProxyHandler",
    );
  }

  private recordSharedServiceUsage(
    observation: ServiceCallObservation,
    req: AuthenticatedRequest,
  ): void {
    if (this.opts.namespace !== "shared" || !this.deps.sharedServiceUsage) {
      return;
    }

    const sharedServiceId = observation.shared_service_id ?? "unknown";
    this.deps.sharedServiceUsage
      .record({
        tribeServiceId: observation.source_service_id,
        sharedServiceId,
        route: req.originalUrl ?? req.url ?? "",
        method: observation.http_method,
        status: observation.status_code,
        ok: observation.status_code < 400,
        latencyMs: observation.latency_ms,
        timestamp: new Date(),
        observation,
      })
      .catch((err) => {
        this.deps.logger.warn(
          `Failed to record shared-service usage for '${sharedServiceId}': ${(err as Error).message}`,
          "ProxyHandler",
        );
      });
  }
  private publishSharedServiceExportEvent(
    tribeId: string,
    targetServiceId: string,
    req: AuthenticatedRequest,
    statusCode: number,
    latencyMs: number,
    responseBody?: unknown,
  ): void {
    if (this.opts.namespace !== "shared" || !this.deps.sharedServiceEvents) {
      return;
    }

    this.deps.sharedServiceEvents.publishSharedServiceCall({
      tribeId,
      environment: this.resolveTargetEnvironment(req),
      sharedServiceId: targetServiceId,
      route: req.originalUrl ?? req.url ?? "",
      method: req.method,
      statusCode,
      ok: statusCode < 400,
      latencyMs,
      correlationId: req.correlationId,
      requestBody: req.body,
      responseBody,
    });
  }

  private recordGatewayTraffic(
    observation: ServiceCallObservation,
    req: AuthenticatedRequest,
  ): void {
    const targetServiceId =
      observation.target_service_id ??
      observation.shared_service_id ??
      "unknown";
    this.deps.gatewayTraffic
      ?.recordProxyRequest({
        namespace: this.opts.namespace,
        sourceTribe: observation.source_service_id,
        targetService: targetServiceId,
        method: observation.http_method,
        statusCode: observation.status_code,
        latencyMs: observation.latency_ms,
        timestamp: new Date(),
        observation,
      })
      .catch((err) => {
        this.deps.logger.warn(
          `Failed to record gateway traffic for '${targetServiceId}': ${(err as Error).message}`,
          "ProxyHandler",
        );
      });

    this.deps.auditEvents
      ?.record({
        type:
          this.opts.namespace === "shared"
            ? "shared_service.call"
            : "tribe_service.call",
        severity:
          observation.status_code >= 500
            ? "error"
            : observation.status_code >= 400
              ? "warning"
              : "info",
        serviceId: targetServiceId,
        tribeServiceId: observation.source_service_id,
        ...(this.opts.namespace === "shared" && {
          sharedServiceId: targetServiceId,
        }),
        message: `${observation.source_service_id} called ${targetServiceId} via ${this.opts.namespace} proxy`,
        payload: {
          route: req.originalUrl ?? req.url ?? "",
          method: observation.http_method,
          statusCode: observation.status_code,
          latencyMs: observation.latency_ms,
          observation,
        },
      })
      .catch((err) => {
        this.deps.logger.warn(
          `Failed to record audit event for '${targetServiceId}': ${(err as Error).message}`,
          "ProxyHandler",
        );
      });
  }

  private buildServiceCallObservation(input: {
    tribeId: string;
    targetServiceId: string;
    targetEnvironment: ApicenterRuntimeEnvironment;
    req: AuthenticatedRequest;
    statusCode: number;
    latencyMs: number;
  }): ServiceCallObservation {
    const targetType =
      this.opts.namespace === "shared" ? "shared_service" : "api_service";
    const targetId = input.targetServiceId || "unknown";
    const outcome = this.resolveServiceCallOutcome(input.statusCode);
    const routeFamily = `${this.opts.namespace}:${targetId}`;
    const requestId = this.resolveRequestId(input.req);
    const sourceServiceId =
      input.req.sourceServiceId ??
      input.req.user?.sourceServiceId ??
      input.tribeId ??
      "unknown";
    const observation: ServiceCallObservation = {
      correlation_id: input.req.correlationId ?? requestId,
      request_id: requestId,
      environment: input.targetEnvironment,
      caller_type: "tribe",
      caller_id: input.tribeId || "unknown",
      source_service_id: sourceServiceId,
      target_type: targetType,
      route_family: routeFamily,
      http_method: input.req.method,
      status_code: input.statusCode,
      outcome,
      latency_ms: Math.max(0, input.latencyMs),
      rollup_key: this.buildServiceCallRollupKey({
        sourceServiceId,
        environment: input.targetEnvironment,
        targetId,
        routeFamily,
      }),
    };

    if (targetType === "shared_service") {
      observation.shared_service_id = targetId;
    } else {
      observation.target_service_id = targetId;
    }

    return observation;
  }

  private resolveRequestId(req: AuthenticatedRequest): string {
    const header = req.headers?.["x-request-id"];
    const requestId = Array.isArray(header) ? header[0] : header;
    return requestId || req.correlationId || "unknown";
  }

  private resolveServiceCallOutcome(statusCode: number): ServiceCallOutcome {
    if (statusCode >= 500) return "server_error";
    if (statusCode >= 400) return "client_error";
    return "success";
  }

  private buildServiceCallRollupKey(input: {
    sourceServiceId: string;
    environment: string;
    targetId: string;
    routeFamily: string;
  }): string {
    return [
      input.sourceServiceId,
      input.environment,
      input.targetId,
      input.routeFamily,
    ].join(":");
  }
  /** Reject retired services (410) and set RFC 8594 deprecation headers. */
  private enforceLifecycleGate(
    entry:
      | {
          status?: string;
          sunsetDate?: string;
          replacementService?: string;
        }
      | null
      | undefined,
    serviceId: string,
    res: Response,
  ): void {
    if (entry?.status === "retired") {
      throw new GoneError(
        `Service '${serviceId}' has been retired` +
          (entry.replacementService
            ? `. Migrate to '${entry.replacementService}'`
            : ""),
      );
    }
    if (entry?.status === "deprecated") {
      res.setHeader("Deprecation", "true");
      if (entry.sunsetDate) {
        res.setHeader("Sunset", new Date(entry.sunsetDate).toUTCString());
      }
      if (entry.replacementService) {
        const nsPrefix = this.opts.namespace === "shared" ? "shared" : "tribes";
        res.setHeader(
          "Link",
          `</api/v1/${nsPrefix}/${entry.replacementService}>; rel="successor-version"`,
        );
      }
    }
  }

  private enforcePolicyRules(
    targetEntry: ReturnType<RegistryService["get"]>,
    req: AuthenticatedRequest,
    res: Response,
  ) {
    if (!targetEntry) return;
    const policyEngine = requireGovernanceDependency(
      this.deps.policyEngine,
      "PolicyEngineService",
    );

    const explanations = policyEngine.evaluate({
      targetEnvironment: this.resolveTargetEnvironment(req),
      serviceType: targetEntry.serviceType ?? "tribe",
      serviceTier: targetEntry.serviceTier,
      lifecycleStatus: targetEntry.status,
      sunsetDate: targetEntry.sunsetDate,
      providerCostSensitive: this.isProviderCostSensitive(targetEntry),
      hasActivePlan: true,
      hasActiveQuota: true,
      hasTargetQuota: false,
    });
    const warnings = explanations.filter(
      (explanation) => explanation.decision === "warn",
    );
    const blocks = explanations.filter(
      (explanation) => explanation.decision === "block",
    );

    if (warnings.length) {
      this.setPolicyHeader(res, "X-API-Center-Policy-Warnings", warnings);
    }
    if (blocks.length) {
      this.setPolicyHeader(res, "X-API-Center-Policy-Block", blocks);
      throw new ForbiddenError(JSON.stringify(blocks[0]));
    }
  }

  private resolveTargetEnvironment(
    req: AuthenticatedRequest,
  ): ApicenterRuntimeEnvironment {
    assertNoEnvironmentOverrides({
      headers: req.headers as Record<string, unknown> | undefined,
      query: req.query as Record<string, unknown> | undefined,
      body: req.body,
    });

    return enforceEnvironmentAccess({
      callerEnvironment: req.user?.environment,
      target: {
        serviceId: "APICenter token",
        environments: [
          { environment: "test", baseUrl: "token://test", status: "active" },
          { environment: "live", baseUrl: "token://live", status: "active" },
        ],
      },
    }).environment;
  }

  private isProviderCostSensitive(targetEntry: object) {
    const record = targetEntry as {
      providerCostSensitive?: boolean;
      quotaHints?: { providerCostSensitive?: boolean };
    };
    const quotaHints = record.quotaHints as
      | { providerCostSensitive?: boolean }
      | undefined;
    return (
      record.providerCostSensitive === true ||
      quotaHints?.providerCostSensitive === true
    );
  }

  private setPolicyHeader(
    res: Response,
    headerName: string,
    explanations: PolicyRuleExplanation[],
  ) {
    res.setHeader(headerName, JSON.stringify(explanations));
  }
}
