// Per-instance request rate limits, counted per caller: an application key's public lookup
// prefix (never the secret part), or the client IP for anything else. Budgets and quotas per
// environment are enforced separately by the control plane.
import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { isHealthCheckPath } from "../health-path";

const APPLICATION_KEY_PREFIX = /^Bearer\s+(ak_(?:test|live)_[a-z0-9]{16})_/;

@Injectable()
export class CallerThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, any>>();
    if (isHealthCheckPath(req.originalUrl ?? req.url ?? req.path)) return true;
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const raw = req.headers?.authorization;
    const authorization = Array.isArray(raw) ? raw[0] : raw;
    const prefix = typeof authorization === "string" ? APPLICATION_KEY_PREFIX.exec(authorization)?.[1] : undefined;
    if (prefix) return `key:${prefix}`;
    return `ip:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
  }
}
