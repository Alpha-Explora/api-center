// =============================================================================
// src/auth/guards/jwt-auth.guard.ts — Provider-agnostic JWT authentication guard
// =============================================================================
// NestJS guard that validates an incoming Bearer JWT using the AuthService,
// which in turn delegates to the configured AuthProvider.
//
// REPLACES: src/auth/guards/descope-auth.guard.ts (Descope-specific guard)
//
// On success, attaches the normalised JwtClaims to:
//   req.user     — the full claims object
//   req.tribeId  — the service/tribe identifier from the claims
//
// Apply per-controller:  @UseGuards(JwtAuthGuard)
// Apply per-route:       @UseGuards(JwtAuthGuard) on a method
// =============================================================================

import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "../auth.service";
import { LoggerService } from "../../shared/logger.service";
import { UnauthorizedError } from "../../shared/errors";
import { AuthenticatedRequest } from "../../types";

const BEARER_PREFIX = "Bearer ";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly logger: LoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorizationHeader = request.headers.authorization;
    const token = authorizationHeader?.startsWith(BEARER_PREFIX)
      ? authorizationHeader.slice(BEARER_PREFIX.length)
      : undefined;

    if (!token) {
      throw new UnauthorizedError("Missing authorization token");
    }

    try {
      // Delegate JWT validation to the active AuthProvider.
      const claims = await this.auth.validateToken(token);

      // Attach normalised claims so controllers and downstream guards can read them
      (request as AuthenticatedRequest).user = claims;
      (request as AuthenticatedRequest).tribeId = claims.tribeId;
      return true;
    } catch (_err) {
      this.logger.warn(
        `Token validation failed from ${request.ip} on ${request.path}`,
        "JwtAuthGuard",
      );
      throw new UnauthorizedError("Invalid or expired token");
    }
  }
}
