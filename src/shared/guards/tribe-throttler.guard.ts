// =============================================================================
// src/shared/guards/tribe-throttler.guard.ts — Per-Tribe Rate Limiting
// =============================================================================
// Custom ThrottlerGuard that buckets rate-limit counters by **tribe ID**
// instead of by client IP.  This prevents a "noisy neighbor" tribe from
// exhausting the global rate-limit pool and starving other tribes.
//
// Tracker resolution order:
//  1. `req.user.tribeId` (verified JWT claim from JwtAuthGuard)
//  2. Valid bearer token tribeId/sub when this global guard runs first
//  3. Client IP          (anonymous / unauthenticated fallback)
// =============================================================================

import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";
import { AuthService } from "../../auth/auth.service";

@Injectable()
export class TribeThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly auth: AuthService,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Return a unique key that the throttler uses to bucket request counts.
   * By keying on the tribe ID we isolate each tribe's rate-limit pool.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const user = req.user as Record<string, any> | undefined;
    if (user?.tribeId) return tribeTracker(String(user.tribeId));

    const token = getBearerToken(req);
    if (token) {
      try {
        const claims = await this.auth.validateToken(token);
        if (claims.tribeId) return tribeTracker(claims.tribeId);
        if (claims.sub) return subjectTracker(claims.sub);
      } catch {
        // Let JwtAuthGuard return the eventual 401. Use IP here so invalid
        // tokens cannot choose arbitrary throttle buckets.
      }
    }

    return req.ip ?? req.connection?.remoteAddress ?? "unknown";
  }
}

function getBearerToken(req: Record<string, any>): string | null {
  const raw = req.headers?.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;

  if (typeof authorization !== "string") {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

function tribeTracker(tribeId: string): string {
  return `tribe:${tribeId}`;
}

function subjectTracker(subject: string): string {
  return `subject:${subject}`;
}
