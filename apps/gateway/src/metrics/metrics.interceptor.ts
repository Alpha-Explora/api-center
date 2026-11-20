// =============================================================================
// src/metrics/metrics.interceptor.ts — HTTP metrics collection interceptor
// =============================================================================
// NestJS interceptor that records http_requests_total and
// http_request_duration_seconds for every request.
// =============================================================================

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Request, Response } from "express";
import { MetricsService } from "./metrics.service";
import { onResponseDone } from "../shared/response-done";

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    // Normalize the route to avoid high-cardinality labels
    const route = request.route?.path || request.path || "unknown";
    const method = request.method;

    onResponseDone(response, (statusCode) => {
      this.metrics.recordHttpRequest(method, route, statusCode, (Date.now() - start) / 1000);
    });
    return next.handle();
  }
}
