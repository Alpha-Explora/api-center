// =============================================================================
// Prometheus metrics for the gateway: request counts and latency by route.
// =============================================================================

import { Injectable } from "@nestjs/common";
import { Counter, Histogram } from "prom-client";

@Injectable()
export class MetricsService {
  readonly httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status_code"] as const,
  });

  readonly httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  recordHttpRequest(method: string, route: string, statusCode: number, durationSec: number) {
    this.httpRequestsTotal.inc({ method, route, status_code: String(statusCode) });
    this.httpRequestDuration.observe({ method, route }, durationSec);
  }
}
