import type { Options } from "http-proxy-middleware";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoggerService } from "../logger.service";
import type { CircuitBreaker } from "../circuit-breaker";
import type { AuthenticatedRequest, ServiceType } from "../../types";
import { getCloudRunAuthorizationHeader } from "./cloud-run-auth";

/** HTTP status codes that indicate upstream failure for circuit-breaker tracking. */
const UPSTREAM_FAILURE_CODES = new Set([502, 503, 504]);

export type UpstreamProxyOptionsInput = {
  targetServiceId: string;
  targetEnvironment: string;
  upstream: string;
  namespace: ServiceType;
  pathPrefix: string;
  proxyTimeoutMs: number;
  correlationId?: string;
  circuitBreakers: Map<string, CircuitBreaker>;
  logger: LoggerService;
};

export async function createUpstreamProxyOptions({
  targetServiceId,
  targetEnvironment,
  upstream,
  pathPrefix,
  proxyTimeoutMs,
  circuitBreakers,
  logger,
}: UpstreamProxyOptionsInput): Promise<
  Options<IncomingMessage, ServerResponse>
> {
  const cloudRunAuthorization = await getCloudRunAuthorizationHeader(upstream);

  return {
    target: upstream,
    changeOrigin: true,
    proxyTimeout: proxyTimeoutMs,
    timeout: proxyTimeoutMs,
    pathRewrite: {
      [`^${pathPrefix}/${targetServiceId}`]: "",
    },
    on: {
      proxyReq: (proxyReq, _req) => {
        const authReq = _req as unknown as AuthenticatedRequest;
        const sourceServiceId =
          authReq.sourceServiceId ??
          authReq.user?.sourceServiceId ??
          authReq.tribeId ??
          "";
        const environment = authReq.user?.environment ?? "";
        const correlationId = authReq.correlationId || "";

        proxyReq.setHeader("X-APICenter-Environment", environment);
        proxyReq.setHeader("X-APICenter-Source-Service-Id", sourceServiceId);
        proxyReq.setHeader("X-APICenter-Correlation-Id", correlationId);
        proxyReq.setHeader("X-Tribe-Id", authReq.tribeId || "");
        proxyReq.setHeader("X-Correlation-ID", correlationId);
        proxyReq.setHeader("X-Forwarded-By", "apicenter-gateway");
        if (cloudRunAuthorization) {
          proxyReq.setHeader("X-Serverless-Authorization", cloudRunAuthorization);
          proxyReq.setHeader("Authorization", cloudRunAuthorization);
        }

        // NestJS body-parser consumes req stream before the proxy sees it.
        // Re-stream the parsed body so the upstream actually receives it.
        if (authReq.body && Object.keys(authReq.body).length > 0) {
          const bodyData = JSON.stringify(authReq.body);
          proxyReq.setHeader("Content-Type", "application/json");
          proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },
      proxyRes: (proxyRes) => {
        const status = proxyRes.statusCode ?? 0;
        const breaker = circuitBreakers.get(
          `${targetServiceId}:${targetEnvironment}`,
        );
        if (breaker) {
          if (UPSTREAM_FAILURE_CODES.has(status)) {
            breaker.recordFailure();
            logger.warn(
              `Upstream '${targetServiceId}' returned ${status} - circuit-breaker failure recorded`,
              "ProxyHandler",
            );
          } else {
            breaker.recordSuccess();
          }
        }
      },
      error: (err) => {
        // Record every proxy-level error (timeouts, ECONNREFUSED, etc.)
        const breaker = circuitBreakers.get(
          `${targetServiceId}:${targetEnvironment}`,
        );
        if (breaker) breaker.recordFailure();
        logger.error(`Proxy error for ${targetServiceId}: ${err.message}`);
      },
    },
    logger: {
      info: (msg: string) => logger.debug(msg),
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string) => logger.error(msg),
    },
  };
}
