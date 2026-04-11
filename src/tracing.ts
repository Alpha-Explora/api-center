// =============================================================================
// src/tracing.ts — OpenTelemetry distributed tracing setup
// =============================================================================
// MUST be imported and initialized BEFORE NestFactory.create() in main.ts.
// OpenTelemetry needs to patch Node.js modules (http, express, etc.) before
// they are first required, so this file must be the very first import.
//
// Exports traces via OTLP HTTP (compatible with Jaeger 1.35+ and OTel collectors).
// The X-Correlation-ID from correlation-id.interceptor.ts is attached
// as a custom span attribute on every request.
// =============================================================================

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Set diagnostic logger in development
if (process.env.NODE_ENV !== 'production') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

let sdk: NodeSDK | null = null;

/**
 * Initialise OpenTelemetry tracing.
 * Accepts optional overrides so callers can pass values from ConfigService
 * without requiring DI (tracing must init before the NestJS container).
 */
export function initTracing(opts?: {
  otlpTracesEndpoint?: string;
  jaegerEndpoint?: string;
  serviceName?: string;
}): void {
  const otlpTracesEndpoint =
    opts?.otlpTracesEndpoint ||
    opts?.jaegerEndpoint ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.JAEGER_ENDPOINT ||
    'http://localhost:4318/v1/traces';
  const serviceName =
    opts?.serviceName || process.env.OTEL_SERVICE_NAME || 'api-center';

  const traceExporter = new OTLPTraceExporter({
    url: otlpTracesEndpoint,
  });

  sdk = new NodeSDK({
    serviceName,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation to reduce noise
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(
    `[Tracing] OpenTelemetry initialized — exporting via OTLP HTTP to ${otlpTracesEndpoint}`,
  );

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(console.error);
  });
}
