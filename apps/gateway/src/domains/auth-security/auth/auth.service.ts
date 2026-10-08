// =============================================================================
// src/auth/auth.service.ts - Provider-agnostic authentication service
// =============================================================================
// Thin orchestration layer that delegates JWT operations to the injected
// AuthProvider and manages refresh token lifecycle via TokenStoreService.
// =============================================================================

import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  AUTH_PROVIDER,
  AuthProvider,
  IssuedToken,
  JwtClaims,
  TokenIssueContext,
} from "./auth-provider.interface";
import { TokenStoreService, RefreshTokenRecord } from "./token-store.service";
import { LoggerService } from "@shared/logger.service";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@shared/errors";
import { AuthenticatedRequest, ApicenterRuntimeEnvironment } from "../../../types";

/** Who a service token speaks for. Resolved from the registry and tenancy, never from the request. */
export interface ServiceTokenIdentity {
  serviceId: string;
  projectId: string;
  tribeId: string;
}

/** What a refresh token claims to be; the caller re-checks it against the registry. */
export interface RefreshSubject {
  serviceId: string;
  environment: ApicenterRuntimeEnvironment;
  projectId: string;
}

/** The identity, permissions, and scopes a service holds right now. */
export interface ServiceTokenGrant {
  identity: ServiceTokenIdentity;
  permissions: string[];
  scopes: string[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly tokenStore: TokenStoreService,
    private readonly logger: LoggerService,
  ) {}

  // ---------------------------------------------------------------------------
  // Token validation
  // ---------------------------------------------------------------------------

  async validateToken(token: string): Promise<JwtClaims> {
    return this.provider.validateToken(token);
  }

  // ---------------------------------------------------------------------------
  // Token issuance
  // ---------------------------------------------------------------------------

  /**
   * Issue a scoped M2M token and persist the refresh token in Redis.
   */
  async issueToken(
    serviceId: string,
    permissions: string[] = [],
    scopes: string[] = [],
    context: TokenIssueContext = {},
  ): Promise<IssuedToken> {
    const resolvedContext = this.resolveIssueContext(serviceId, context);
    const issued = await this.provider.issueToken(
      serviceId,
      permissions,
      scopes,
      resolvedContext,
    );

    if (issued.refreshToken) {
      await this.persistRefreshToken(
        issued,
        serviceId,
        permissions,
        scopes,
        resolvedContext,
      );
    }

    return issued;
  }

  /** Issue a token bound to one tribe service: sub = sourceServiceId = serviceId. */
  async issueServiceToken(
    identity: ServiceTokenIdentity,
    permissions: string[] = [],
    scopes: string[] = [],
    environment: ApicenterRuntimeEnvironment,
  ): Promise<IssuedToken> {
    if (!environment) {
      throw new ValidationError("Token environment is required");
    }

    return this.issueToken(identity.serviceId, permissions, scopes, {
      tribeId: identity.tribeId,
      projectId: identity.projectId,
      sourceServiceId: identity.serviceId,
      environment,
    });
  }

  // ---------------------------------------------------------------------------
  // Token refresh
  // ---------------------------------------------------------------------------

  /**
   * Exchange a refresh token for a new access token.
   *
   * A refresh never replays the claims of the old token. The caller supplies `revalidate`, which looks the
   * service up again (registry, project, tribe) and returns the identity and scopes that apply now, or
   * throws when the service may no longer hold a token. Tokens without a stored project are refused, so
   * tokens issued before the project hierarchy must be requested again.
   */
  async refreshToken(
    refreshToken: string,
    revalidate: (subject: RefreshSubject) => ServiceTokenGrant,
  ): Promise<IssuedToken> {
    let claims: JwtClaims;
    try {
      claims = await this.provider.validateToken(refreshToken);
    } catch {
      throw new UnauthorizedError("Refresh token is invalid or expired");
    }

    const jti = typeof claims.jti === "string" ? claims.jti : undefined;
    if (!jti) {
      throw new UnauthorizedError("Refresh token cannot be verified; request a new token");
    }
    if (!(await this.tokenStore.isValid(jti))) {
      throw new UnauthorizedError("Refresh token has been revoked or expired");
    }
    const storedRecord = await this.tokenStore.get(jti);
    if (!storedRecord) {
      throw new UnauthorizedError("Refresh token metadata is unavailable");
    }
    if (!storedRecord.projectId) {
      throw new UnauthorizedError(
        "Refresh token predates project placement; request a new token",
      );
    }

    const grant = revalidate({
      serviceId: storedRecord.sourceServiceId ?? claims.sourceServiceId ?? claims.sub,
      environment: storedRecord.environment,
      projectId: storedRecord.projectId,
    });

    // Revoke before issuing so one refresh token never produces two live descendants.
    await this.tokenStore.revoke(jti);

    return this.issueServiceToken(
      grant.identity,
      grant.permissions,
      grant.scopes,
      storedRecord.environment,
    );
  }

  // ---------------------------------------------------------------------------
  // Token revocation
  // ---------------------------------------------------------------------------

  /**
   * Revoke a refresh token by JTI.
   * When revokeAll=true, revokes all tokens for the subject.
   *
   * @returns number of tokens revoked
   */
  async revokeToken(
    refreshToken: string,
    revokeAll = false,
  ): Promise<{ revokedCount: number; sub: string }> {
    let jti: string | undefined;
    let sub: string | undefined;

    try {
      const claims = await this.provider.validateToken(refreshToken);
      jti = claims.jti as string | undefined;
      sub = claims.sub;
    } catch {
      // Token may already be expired - attempt lookup by raw value
    }

    if (!sub && !jti) {
      throw new UnauthorizedError(
        "Cannot parse refresh token - it may already be expired or invalid",
      );
    }

    let revokedCount = 0;

    if (revokeAll && sub) {
      revokedCount = await this.tokenStore.revokeAllForSubject(sub);
    } else if (jti) {
      const revoked = await this.tokenStore.revoke(jti);
      revokedCount = revoked ? 1 : 0;
    }

    this.logger.log(
      `Revoked ${revokedCount} token(s) for sub=${sub ?? "unknown"} (revokeAll=${revokeAll})`,
      "AuthService",
    );

    return { revokedCount, sub: sub ?? "unknown" };
  }

  // ---------------------------------------------------------------------------
  // Authorisation helpers
  // ---------------------------------------------------------------------------

  async authorize(
    req: AuthenticatedRequest,
    requiredPermission: string,
  ): Promise<void> {
    const permissions = this.mergeCallerScopes(req.user ?? {});
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenError(`Missing permission: '${requiredPermission}'`);
    }
  }

  mergeCallerScopes(claims: Partial<JwtClaims>): string[] {
    return [...(claims.scopes ?? []), ...(claims.permissions ?? [])];
  }

  checkScopes(req: AuthenticatedRequest, requiredScopes: string[]): string[] {
    const callerScopes = this.mergeCallerScopes(req.user ?? {});
    return requiredScopes.filter((s) => !callerScopes.includes(s));
  }

  // ---------------------------------------------------------------------------
  // JWKS passthrough (DevJwtProvider only)
  // ---------------------------------------------------------------------------

  getJwksJson(): Record<string, unknown> | null {
    return this.provider.getJwksJson();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveIssueContext(
    serviceId: string,
    context: TokenIssueContext = {},
  ): TokenIssueContext {
    return {
      ...context,
      sourceServiceId: context.sourceServiceId ?? serviceId,
    };
  }

  private async persistRefreshToken(
    issued: IssuedToken,
    sub: string,
    permissions: string[],
    scopes: string[],
    context: TokenIssueContext,
  ): Promise<void> {
    if (!issued.refreshToken) return;

    const environment = await this.resolveRefreshEnvironment(
      issued.refreshToken,
      context.environment,
    );
    if (!environment) {
      throw new ValidationError("Refresh token environment is required");
    }

    let jti: string = randomUUID();
    try {
      const claims = await this.provider.validateToken(issued.refreshToken);
      if (typeof claims.jti === "string" && claims.jti.trim().length > 0) {
        jti = claims.jti;
      }
    } catch {
      // Some providers return opaque refresh tokens. Keep a generated record ID
      // for best-effort storage without blocking issuance.
    }

    const now = Math.floor(Date.now() / 1000);
    const refreshExpiresIn = issued.refreshExpiresIn ?? issued.expiresIn * 24;

    const record: RefreshTokenRecord = {
      jti,
      sub,
      ...(context.tribeId ? { tribeId: context.tribeId } : {}),
      ...(context.projectId ? { projectId: context.projectId } : {}),
      sourceServiceId: context.sourceServiceId ?? sub,
      environment,
      issuedAt: now,
      expiresAt: now + refreshExpiresIn,
      scopes,
      permissions,
    };

    await this.tokenStore.store(record).catch((err) => {
      this.logger.warn(
        `Failed to persist refresh token for sub=${sub}: ${(err as Error).message}`,
        "AuthService",
      );
    });
  }

  private async resolveRefreshEnvironment(
    refreshToken: string,
    environment?: ApicenterRuntimeEnvironment,
  ): Promise<ApicenterRuntimeEnvironment | undefined> {
    if (environment) return environment;

    try {
      const claims = await this.provider.validateToken(refreshToken);
      return claims.environment;
    } catch {
      return undefined;
    }
  }
}
