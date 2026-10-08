// =============================================================================
// src/auth/auth-provider.interface.ts - Pluggable AuthProvider abstraction
// =============================================================================
// Defines the contract that every auth-provider implementation must satisfy.
//
// Shipped implementations:
//   - DescopeProvider       - production-grade OIDC/JWKS validation
//   - InternalJwtProvider   - API Center signed M2M tokens
//   - CompositeAuthProvider - internal JWT issuer plus Descope validation fallback
//   - DevJwtProvider        - lightweight RS256 issuer for local dev and CI
//
// Selecting a provider is done via the AUTH_PROVIDER env var:
//   AUTH_PROVIDER=descope      -> DescopeProvider
//   AUTH_PROVIDER=internal-jwt -> InternalJwtProvider
//   AUTH_PROVIDER=composite    -> issue internal JWTs, validate internal + Descope
//   AUTH_PROVIDER=dev-jwt      -> DevJwtProvider (default)
// =============================================================================

import type { ApicenterRuntimeEnvironment } from "../../../types";

/** Normalised JWT claims extracted from a validated access token. */
export interface JwtClaims {
  /** Token subject - typically the service/user ID */
  sub: string;
  /** Tribe that owns the calling service (derived from its project at issuance) */
  tribeId?: string;
  /** Project the calling service belongs to */
  projectId?: string;
  /** The calling service. Always the credential's service; equals sub for API Center tokens. */
  sourceServiceId?: string;
  /** API Center runtime environment represented by this token. */
  environment?: ApicenterRuntimeEnvironment;
  /** Permission strings embedded in the token */
  permissions?: string[];
  /** Service scopes embedded in the token */
  scopes?: string[];
  /** Raw expiry epoch (seconds since UNIX epoch) */
  exp?: number;
  /** Pass-through for any additional provider-specific claims */
  [key: string]: unknown;
}


/** Runtime context embedded when issuing API Center M2M tokens. */
export interface TokenIssueContext {
  tribeId?: string;
  projectId?: string;
  sourceServiceId?: string;
  environment?: ApicenterRuntimeEnvironment;
}
/** Token bundle returned after a successful issuance or refresh */
export interface IssuedToken {
  /** Short-lived access JWT (Bearer token) */
  accessToken: string;
  /** Long-lived refresh token; null when the provider does not issue one */
  refreshToken: string | null;
  /** Seconds until the access token expires */
  expiresIn: number;
  /** Seconds until the refresh token expires, when known */
  refreshExpiresIn?: number;
}

/**
 * AuthProvider - the single interface all auth backends must implement.
 *
 * Responsibilities:
 *  1. validateToken - verify a Bearer JWT and return normalised claims
 *  2. issueToken    - issue a scoped M2M JWT for a given service
 *  3. refreshToken  - exchange a refresh token for a new access token
 *  4. getJwksJson   - return an in-process JWKS document when self-issuing
 */
export interface AuthProvider {
  /**
   * Validate an incoming Bearer JWT.
   * Must throw (or reject) on expiry, invalid signature, wrong issuer, etc.
   *
   * @param token - raw JWT string from the Authorization header
   * @returns normalised JwtClaims
   */
  validateToken(token: string): Promise<JwtClaims>;

  /**
   * Issue a scoped M2M access token for a service.
   *
   * @param serviceId - the service requesting the token
   * @param permissions - permission strings to embed
   * @param scopes - service scopes to embed
   */
  issueToken(
    serviceId: string,
    permissions: string[],
    scopes: string[],
    context?: TokenIssueContext,
  ): Promise<IssuedToken>;

  /**
   * Exchange a refresh token for a new access token.
   *
   * @param refreshToken - the refresh token received during initial issuance
   */
  refreshToken(refreshToken: string): Promise<IssuedToken>;

  /**
   * Return the in-process JWKS JSON document for self-issuing providers such as
   * InternalJwtProvider and DevJwtProvider. Provider-backed validation modes can
   * return null because clients fetch the JWKS from that provider directly.
   */
  getJwksJson(): Record<string, unknown> | null;
}

/** NestJS injection token for the active AuthProvider */
export const AUTH_PROVIDER = "AUTH_PROVIDER";
