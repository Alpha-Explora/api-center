// =============================================================================
// src/metrics/metrics.service.ts — Prometheus metrics collector
// =============================================================================
// Exposes application-level metrics for Prometheus scraping.
//
// METRICS:
//  - http_requests_total          (counter)   — Total HTTP requests
//  - http_request_duration_seconds (histogram) — Request latency distribution
//  - circuit_breaker_state        (gauge)     — 0=CLOSED 1=OPEN 2=HALF_OPEN
//  - registry_services_total      (gauge)     — Number of registered services
// =============================================================================

import { Injectable, OnModuleInit } from "@nestjs/common";
import { Counter, Histogram, Gauge } from "prom-client";

type LifecycleStatusLabel = "proposed" | "active" | "deprecated" | "retired";
type KafkaPublishOutcome = "success" | "failure";

@Injectable()
export class MetricsService implements OnModuleInit {
  // ---- HTTP Metrics ----
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;

  // ---- Circuit Breaker Metrics ----
  readonly circuitBreakerState: Gauge;

  // ---- Registry Metrics ----
  readonly registryServicesTotal: Gauge;
  readonly registryServicesByStatusTotal: Gauge;
  readonly registryBootstrapOperationsTotal: Counter;
  readonly registryDiscoveryRequestsTotal: Counter;
  readonly kafkaGovernanceOperationsTotal: Counter;
  readonly kafkaPublishOperationsTotal: Counter;
  readonly kafkaProducerConnected: Gauge;

  // ---- Showback / Usage Metrics ----
  readonly proxyRequestsTotal: Counter;
  readonly proxyRequestDuration: Histogram;

  /** @deprecated Use proxyRequestsTotal — kept as alias for backwards compat */
  readonly tribeRequestsTotal: Counter;
  /** @deprecated Use proxyRequestDuration — kept as alias for backwards compat */
  readonly tribeRequestDuration: Histogram;

  constructor() {
    this.httpRequestsTotal = new Counter({
      name: "http_requests_total",
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status_code"] as const,
    });

    this.httpRequestDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request duration in seconds",
      labelNames: ["method", "route"] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    this.circuitBreakerState = new Gauge({
      name: "circuit_breaker_state",
      help: "Circuit breaker state: 0=CLOSED 1=OPEN 2=HALF_OPEN",
      labelNames: ["api_name"] as const,
    });

    this.registryServicesTotal = new Gauge({
      name: "registry_services_total",
      help: "Total number of registered services in the registry",
    });

    this.registryServicesByStatusTotal = new Gauge({
      name: "registry_services_by_status_total",
      help: "Total number of registered services grouped by lifecycle status",
      labelNames: ["status"] as const,
    });

    this.registryBootstrapOperationsTotal = new Counter({
      name: "registry_bootstrap_operations_total",
      help: "Registry bootstrap outcomes grouped by seed source and service labels",
      labelNames: [
        "outcome",
        "seed_source",
        "service_type",
        "lifecycle_status",
      ] as const,
    });

    this.registryDiscoveryRequestsTotal = new Counter({
      name: "registry_discovery_requests_total",
      help: "Total service discovery requests grouped by namespace and caller type",
      labelNames: ["namespace", "caller_type", "lifecycle_status"] as const,
    });

    this.kafkaGovernanceOperationsTotal = new Counter({
      name: "kafka_governance_operations_total",
      help: "Kafka governance endpoint operations grouped by action and outcome",
      labelNames: ["operation", "outcome"] as const,
    });

    this.kafkaPublishOperationsTotal = new Counter({
      name: "kafka_publish_operations_total",
      help: "Kafka publish attempts grouped by topic and outcome",
      labelNames: ["topic", "outcome"] as const,
    });

    this.kafkaProducerConnected = new Gauge({
      name: "kafka_producer_connected",
      help: "Kafka producer connection state: 1=connected, 0=disconnected",
    });

    this.proxyRequestsTotal = new Counter({
      name: "proxy_requests_total",
      help: "Total proxy requests for showback attribution (shared + tribe)",
      labelNames: [
        "namespace",
        "source_tribe",
        "target_service",
        "method",
        "status_code",
      ] as const,
    });

    this.proxyRequestDuration = new Histogram({
      name: "proxy_request_duration_seconds",
      help: "Proxy request duration in seconds for showback attribution",
      labelNames: ["namespace", "source_tribe", "target_service"] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    // Backwards-compat aliases
    this.tribeRequestsTotal = this.proxyRequestsTotal;
    this.tribeRequestDuration = this.proxyRequestDuration;
  }

  onModuleInit() {
    // Initialize all circuit breaker gauges to 0 (CLOSED)
    this.registryServicesTotal.set(0);
    this.registryServicesByStatusTotal.set({ status: "proposed" }, 0);
    this.registryServicesByStatusTotal.set({ status: "active" }, 0);
    this.registryServicesByStatusTotal.set({ status: "deprecated" }, 0);
    this.registryServicesByStatusTotal.set({ status: "retired" }, 0);
    this.kafkaProducerConnected.set(0);
  }

  /**
   * Record an HTTP request.
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSec: number,
  ) {
    this.httpRequestsTotal.inc({
      method,
      route,
      status_code: String(statusCode),
    });
    this.httpRequestDuration.observe({ method, route }, durationSec);
  }

  /**
   * Update circuit breaker state gauge.
   * @param apiName — The external API name
   * @param state   — 'CLOSED' | 'OPEN' | 'HALF_OPEN'
   */
  setCircuitBreakerState(apiName: string, state: string) {
    let stateValue = 0;
    if (state === "OPEN") stateValue = 1;
    else if (state === "HALF_OPEN") stateValue = 2;
    this.circuitBreakerState.set({ api_name: apiName }, stateValue);
  }

  /**
   * Update the total number of registered services.
   */
  setRegistryServicesCount(count: number) {
    this.registryServicesTotal.set(count);
  }

  setRegistryServicesCountByStatus(
    status: LifecycleStatusLabel,
    count: number,
  ) {
    this.registryServicesByStatusTotal.set({ status }, count);
  }

  recordRegistryBootstrapSeed(
    outcome: "loaded" | "skipped" | "failed",
    seedSource: string,
    serviceType: "shared" | "tribe",
    lifecycleStatus: LifecycleStatusLabel,
  ) {
    this.registryBootstrapOperationsTotal.inc({
      outcome,
      seed_source: seedSource,
      service_type: serviceType,
      lifecycle_status: lifecycleStatus,
    });
  }

  recordServiceDiscoverySnapshot(
    namespace: "shared" | "tribe",
    callerType: "authenticated" | "anonymous",
    lifecycleStatuses: LifecycleStatusLabel[],
  ) {
    const statusCounts = {
      proposed: 0,
      active: 0,
      deprecated: 0,
      retired: 0,
    };

    for (const status of lifecycleStatuses) {
      statusCounts[status] += 1;
    }

    this.registryDiscoveryRequestsTotal.inc({
      namespace,
      caller_type: callerType,
      lifecycle_status: "all",
    });

    this.registryDiscoveryRequestsTotal.inc(
      {
        namespace,
        caller_type: callerType,
        lifecycle_status: "proposed",
      },
      statusCounts.proposed,
    );

    this.registryDiscoveryRequestsTotal.inc(
      {
        namespace,
        caller_type: callerType,
        lifecycle_status: "active",
      },
      statusCounts.active,
    );

    this.registryDiscoveryRequestsTotal.inc(
      {
        namespace,
        caller_type: callerType,
        lifecycle_status: "deprecated",
      },
      statusCounts.deprecated,
    );

    this.registryDiscoveryRequestsTotal.inc(
      {
        namespace,
        caller_type: callerType,
        lifecycle_status: "retired",
      },
      statusCounts.retired,
    );
  }

  recordKafkaGovernanceOperation(
    operation: "publish" | "catalog" | "schemas",
    outcome: "success" | "failure",
  ) {
    this.kafkaGovernanceOperationsTotal.inc({ operation, outcome });
  }

  recordKafkaPublish(topic: string, outcome: KafkaPublishOutcome) {
    this.kafkaPublishOperationsTotal.inc({ topic, outcome });
  }

  setKafkaProducerConnected(connected: boolean) {
    this.kafkaProducerConnected.set(connected ? 1 : 0);
  }

  /**
   * Record a proxy request for showback attribution (works for both namespaces).
   */
  recordProxyRequest(
    namespace: string,
    sourceTribe: string,
    targetService: string,
    method: string,
    statusCode: number,
    durationSec: number,
  ) {
    this.proxyRequestsTotal.inc({
      namespace,
      source_tribe: sourceTribe,
      target_service: targetService,
      method,
      status_code: String(statusCode),
    });
    this.proxyRequestDuration.observe(
      { namespace, source_tribe: sourceTribe, target_service: targetService },
      durationSec,
    );
  }

  /**
   * @deprecated Use recordProxyRequest — kept for backwards compatibility.
   */
  recordTribeRequest(
    sourceTribe: string,
    targetService: string,
    method: string,
    statusCode: number,
    durationSec: number,
  ) {
    this.recordProxyRequest(
      "tribe",
      sourceTribe,
      targetService,
      method,
      statusCode,
      durationSec,
    );
  }
}
