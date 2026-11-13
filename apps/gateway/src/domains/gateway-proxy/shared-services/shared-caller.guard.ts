import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { isApplicationCredential } from "@domains/control-plane/control-plane.types";
import type { AuthenticatedRequest } from "../../../types";

const BEARER_PREFIX = "Bearer ";

export function bearerToken(req: AuthenticatedRequest): string | undefined {
  const header = req.headers?.authorization;
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : undefined;
}

/**
 * Admits a shared-service call for one of two caller models. An `ak_` application credential
 * passes through to ApplicationCapabilityProxy, which authenticates and authorizes it and fails
 * closed. Every other bearer goes through the legacy JwtAuthGuard unchanged.
 */
@Injectable()
export class SharedCallerGuard implements CanActivate {
  constructor(private readonly jwt: JwtAuthGuard) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (isApplicationCredential(bearerToken(request))) return true;
    return this.jwt.canActivate(context);
  }
}
