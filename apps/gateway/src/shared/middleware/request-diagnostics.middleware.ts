import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types";
import { RequestDiagnosticsStore } from "../request-diagnostics.store";
import { LoggerService } from "../logger.service";
import { isHealthCheckPath } from "../health-path";

const safeCorrelation = /^[a-zA-Z0-9._:-]{1,128}$/;
const failure = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  stage: z.enum(["runtime", "provider"]).optional(),
});
export function failureStage(
  status: number,
  code: string | null,
): string | null {
  if (status < 400) return null;
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 429) return "quota";
  if (code?.startsWith("PROVIDER_")) return "provider";
  if (code?.startsWith("RUNTIME_")) return "runtime";
  if (code === "SERVICE_NOT_FOUND" || code === "ROUTE_NOT_FOUND")
    return "routing";
  return "unknown";
}

@Injectable()
export class RequestDiagnosticsMiddleware implements NestMiddleware {
  constructor(
    private readonly diagnostics: RequestDiagnosticsStore,
    private readonly logger: LoggerService,
  ) {}
  use(request: AuthenticatedRequest, response: Response, next: NextFunction) {
    if (isHealthCheckPath(request.path)) return next();
    const requestId = randomUUID();
    const provided = request.headers["x-correlation-id"];
    const correlationId =
      typeof provided === "string" && safeCorrelation.test(provided)
        ? provided
        : requestId;
    request.correlationId = correlationId;
    request.headers["x-correlation-id"] = correlationId;
    response.setHeader("X-Correlation-ID", correlationId);
    response.setHeader("X-Request-ID", requestId);
    const start = Date.now();
    response.once("finish", () => {
      const principal = request.paymentPrincipal;
      const error = failure.safeParse(response.locals.requestDiagnostic);
      const route =
        typeof request.route?.path === "string"
          ? request.route.path
          : "[unmatched]";
      void this.diagnostics
        .record({
          requestId,
          correlationId,
          serviceId:
            principal?.consumerServiceId ?? request.sourceServiceId ?? null,
          projectId: principal?.projectId ?? request.projectId ?? null,
          environment:
            principal?.environment ??
            request.user?.environment ??
            request.diagnosticEnvironment ??
            null,
          route: route.slice(0, 300),
          method: request.method,
          statusCode: response.statusCode,
          errorCode: error.success ? error.data.code : null,
          paymentResourceId: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,200}$/)
            .nullable()
            .catch(null)
            .parse(response.locals.paymentResourceId ?? null),
          failureStage:
            error.success && error.data.stage
              ? error.data.stage
              : failureStage(
                  response.statusCode,
                  error.success ? error.data.code : null,
                ),
          durationMs: Math.max(0, Date.now() - start),
        })
        .catch(() =>
          this.logger.warn(
            "Request diagnostic persistence unavailable",
            "RequestDiagnostics",
          ),
        );
    });
    next();
  }
}
