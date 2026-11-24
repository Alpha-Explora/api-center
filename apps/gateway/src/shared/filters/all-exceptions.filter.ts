// =============================================================================
// src/shared/filters/all-exceptions.filter.ts — Global exception filter
// =============================================================================
// NestJS exception filter that catches all unhandled errors.
//
// REPLACES: Express's errorHandler middleware (must have 4 params).
// NestJS ADVANTAGE: Filters are type-safe, support DI, and can be scoped
// to controllers, methods, or the entire app.
//
// Handles:
//  - AppError subclasses (operational errors we threw intentionally)
//  - NestJS HttpException (from ValidationPipe, ThrottlerGuard, etc.)
//  - Unexpected errors (bugs, unhandled exceptions)
// =============================================================================

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AppError } from "../errors";
import { LoggerService } from "../logger.service";
import { ConfigService } from "../../config/config.service";
import { AuthenticatedRequest } from "../../types";
import { mapDatabaseError } from "./database-errors";

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = (request as AuthenticatedRequest).correlationId;

    // --- NestJS HttpException (includes ValidationPipe errors, throttle, etc.) ---
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Handle class-validator errors from ValidationPipe
      if (
        typeof exceptionResponse === "object" &&
        "message" in (exceptionResponse as Record<string, unknown>)
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        const messages = Array.isArray(resp.message)
          ? resp.message
          : [resp.message];

        // AppError subclasses have a `code` property. Nest's own exceptions carry only a reason
        // phrase ("Not Found"), so they get the code their status stands for.
        const code =
          exception instanceof AppError
            ? exception.code
            : typeof resp.code === "string" && resp.code
              ? resp.code
              : codeForStatus(status);
        response.locals.requestDiagnostic = { code };

        this.logger.warn(
          `HTTP ${status}: ${messages.join(", ")}`,
          "ExceptionFilter",
        );

        response.status(status).json({
          success: false,
          error: {
            code,
            message: messages.length === 1 ? messages[0] : "Validation failed",
            ...(messages.length > 1 && { details: messages }),
            ...(exception instanceof AppError && "details" in resp && { details: resp.details }),
            ...("detail" in resp && { detail: resp.detail }),
          },
          meta: { timestamp: new Date().toISOString(), correlationId },
        });
        return;
      }

      const code = codeForStatus(status);
      response.locals.requestDiagnostic = { code };
      response.status(status).json({
        success: false,
        error: {
          code,
          message: exception.message,
        },
        meta: { timestamp: new Date().toISOString(), correlationId },
      });
      return;
    }

    // --- Database failures with a meaningful status (busy pool, duplicates) ---
    const database = mapDatabaseError(exception);
    if (database) {
      const err = exception as Error;
      if (database.status >= 500) {
        this.logger.error(`Database unavailable (${database.code}): ${err?.message}`, err?.stack, "ExceptionFilter");
      } else {
        this.logger.warn(`HTTP ${database.status} ${database.code}: ${err?.message}`, "ExceptionFilter");
      }
      response.locals.requestDiagnostic = { code: database.code };
      if (database.retryAfterSeconds) response.setHeader("Retry-After", String(database.retryAfterSeconds));
      response.status(database.status).json({
        success: false,
        error: { code: database.code, message: database.message },
        meta: { timestamp: new Date().toISOString(), correlationId },
      });
      return;
    }

    // --- Unexpected errors (bugs) ---
    const err = exception as Error;
    this.logger.error(
      `Unexpected error: ${err?.message || "Unknown error"}`,
      err?.stack,
      "ExceptionFilter",
    );

    response.locals.requestDiagnostic = { code: "INTERNAL_ERROR" };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: this.config.isProduction
          ? "An unexpected error occurred"
          : err?.message || "Internal server error",
        ...(!this.config.isProduction && { stack: err?.stack }),
      },
      meta: { timestamp: new Date().toISOString(), correlationId },
    });
  }
}

/** Codes for failures without a domain code. Every code is UPPER_SNAKE_CASE, like the domain codes. */
const STATUS_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  408: "REQUEST_TIMEOUT",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT",
};

export function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? `HTTP_${status}`;
}
