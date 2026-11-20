// Logs one "Audit log" line per request, with the status the client received.

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Request, Response } from "express";
import { LoggerService } from "../logger.service";
import { AuthenticatedRequest } from "../../types";
import { isHealthCheckPath } from "../health-path";
import { onResponseDone } from "../response-done";

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    if (isHealthCheckPath(request.originalUrl || request.url || request.path)) {
      return next.handle();
    }

    onResponseDone(response, (statusCode) => this.publishAudit(request, statusCode, start));
    return next.handle();
  }

  private publishAudit(request: Request, statusCode: number, start: number) {
    const authReq = request as AuthenticatedRequest;

    this.logger.info("Audit log", {
      method: request.method,
      path: request.originalUrl,
      statusCode,
      durationMs: Date.now() - start,
      ip: request.ip || "unknown",
      correlationId: authReq.correlationId,
      ...(authReq.caller && { applicationId: authReq.caller.applicationId, environment: authReq.caller.environmentKind }),
    });
  }
}

