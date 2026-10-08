// =============================================================================
// src/auth/providers/descope.provider.ts — Descope OIDC/JWKS AuthProvider
// =============================================================================
// Production provider that validates JWTs using Descope JWKS and exchanges
// tokens through the configured OAuth2 token endpoint.
//
// Claim mapping policy (first-class contract for this migration):
//   - tribeId     ← custom app claim (fallback paths supported)
//   - permissions ← custom app claim array (fallback paths supported)
//   - scopes      ← custom app claim array or OAuth2 scope string
// =============================================================================

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";
import axios from "axios";
import {
  AuthProvider,
  IssuedToken,
  JwtClaims,
  TokenIssueContext,
} from "../auth-provider.interface";
import { ConfigService } from "@config/config.service";

const DEFAULT_TIMEOUT_MS = 10_000;

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }
  if (typeof value === "string") {
    return value
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getPathValue(payload: Record<string, unknown>, path: string): unknown {
  const pathSegments = path.split(".");
  let current: unknown = payload;

  for (const segment of pathSegments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function firstString(
  payload: Record<string, unknown>,
  paths: string[],
): string | undefined {
  for (const path of paths) {
    const value = getPathValue(payload, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function firstStringArray(
  payload: Record<string, unknown>,
  paths: string[],
): string[] {
  for (const path of paths) {
    const value = getPathValue(payload, path);
    const parsed = toStringArray(value);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

export function mapDescopeClaims(payload: JWTPayload): JwtClaims {
  const rawPayload = payload as Record<string, unknown>;
  const sub = payload.sub || firstString(rawPayload, ["userId", "user_id"]);

  if (!sub) {
    throw new Error("Validated token is missing subject claim (sub)");
  }

  const tribeId = firstString(rawPayload, [
    "tribeId",
    "customClaims.tribeId",
    "custom_claims.tribeId",
    "attributes.tribeId",
  ]);

  const projectId = firstString(rawPayload, [
    "projectId",
    "customClaims.projectId",
    "custom_claims.projectId",
    "attributes.projectId",
  ]);

  const sourceServiceId = firstString(rawPayload, [
    "sourceServiceId",
    "serviceId",
    "customClaims.serviceId",
    "custom_claims.serviceId",
    "attributes.serviceId",
  ]);

  const permissions = firstStringArray(rawPayload, [
    "permissions",
    "customClaims.permissions",
    "custom_claims.permissions",
    "authorization.permissions",
    "roles",
  ]);

  const scopes = firstStringArray(rawPayload, [
    "scopes",
    "customClaims.scopes",
    "custom_claims.scopes",
    "scope",
  ]);

  return {
    sub,
    tribeId,
    projectId,
    sourceServiceId,
    permissions,
    scopes,
    exp: payload.exp,
    ...payload,
  };
}

@Injectable()
export class DescopeProvider implements AuthProvider, OnModuleInit {
  private readonly logger = new Logger(DescopeProvider.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.config.authProvider !== "descope") {
      return;
    }

    this.ensureJwksConfigured();
    this.logger.log(
      `DescopeProvider ready — JWKS: ${this.config.descope.jwksUri}`,
    );
  }

  async validateToken(token: string): Promise<JwtClaims> {
    this.ensureJwksConfigured();

    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      ...(this.config.descope.issuer
        ? { issuer: this.config.descope.issuer }
        : {}),
      ...(this.config.descope.audience
        ? { audience: this.config.descope.audience }
        : {}),
    };

    const { payload } = await jwtVerify(token, this.jwks!, verifyOptions);
    return mapDescopeClaims(payload);
  }

  async issueToken(
    serviceId: string,
    _permissions: string[],
    scopes: string[],
    _context?: TokenIssueContext,
  ): Promise<IssuedToken> {
    const clientSecretEnvKey = `DESCOPE_CLIENT_SECRET_${serviceId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const clientSecret =
      process.env[clientSecretEnvKey] ??
      this.config.descope.defaultClientSecret;
    if (!clientSecret) {
      throw new Error(
        `No Descope client secret found for service '${serviceId}'. ` +
          `Set ${clientSecretEnvKey} or DESCOPE_DEFAULT_CLIENT_SECRET.`,
      );
    }

    const scopeString = ["openid", ...scopes].join(" ").trim();
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: serviceId,
      client_secret: clientSecret,
      ...(scopeString ? { scope: scopeString } : {}),
    });

    const response = await axios.post<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }>(this.config.descope.tokenEndpoint, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: DEFAULT_TIMEOUT_MS,
    });

    this.logger.log(`M2M token issued for service '${serviceId}' via Descope`);

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token ?? null,
      expiresIn: response.data.expires_in,
    };
  }

  async refreshToken(refreshToken: string): Promise<IssuedToken> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.descope.refreshClientId || "api-center",
      ...(this.config.descope.defaultClientSecret
        ? { client_secret: this.config.descope.defaultClientSecret }
        : {}),
    });

    const response = await axios.post<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }>(this.config.descope.tokenEndpoint, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: DEFAULT_TIMEOUT_MS,
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token ?? null,
      expiresIn: response.data.expires_in,
    };
  }

  getJwksJson(): null {
    return null;
  }

  private ensureJwksConfigured(): void {
    if (this.jwks) {
      return;
    }

    if (!this.config.descope.jwksUri) {
      throw new Error(
        "DescopeProvider not initialised — DESCOPE_JWKS_URI missing",
      );
    }

    this.jwks = createRemoteJWKSet(new URL(this.config.descope.jwksUri));
  }
}
