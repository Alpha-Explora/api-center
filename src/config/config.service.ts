// =============================================================================
// src/config/config.service.ts — Centralized application configuration
// =============================================================================

import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_REGISTRY_BOOTSTRAP_MANIFESTS = [
  "examples/logistics-manifest.json",
  "examples/demand-manifest.json",
];

@Injectable()
export class ConfigService implements OnApplicationBootstrap {
  readonly port: number = parseInt(process.env.PORT || "3000", 10);
  readonly nodeEnv: string = process.env.NODE_ENV || "development";

  readonly cors = {
    origin: this.parseAllowedOrigins(),
    credentials: true,
  };

  // AUTH_PROVIDER=keycloak  → KeycloakProvider (production)
  // AUTH_PROVIDER=descope   → DescopeProvider  (production)
  // AUTH_PROVIDER=google    → GoogleProvider   (Google OAuth2 / OIDC)
  // AUTH_PROVIDER=dev-jwt   → DevJwtProvider   (local dev / CI) [default]
  readonly authProvider: string = process.env.AUTH_PROVIDER || "dev-jwt";

  private readonly descopeBaseUrl =
    process.env.DESCOPE_BASE_URL || "https://api.descope.com";
  private readonly descopeProjectId = process.env.DESCOPE_PROJECT_ID || "";

  readonly google = {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    allowedDomains: (process.env.GOOGLE_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    allowedRedirectOrigins: this.parseGoogleAllowedRedirectOrigins(),
    // Redirect URI registered in Google Cloud Console
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      "http://localhost:3000/api/v1/auth/google/callback",
  };

  readonly keycloak = {
    baseUrl: process.env.KEYCLOAK_BASE_URL || "http://localhost:8080",
    realm: process.env.KEYCLOAK_REALM || "api-center",
    jwksUri:
      process.env.KEYCLOAK_JWKS_URI ||
      `${process.env.KEYCLOAK_BASE_URL || "http://localhost:8080"}/realms/${process.env.KEYCLOAK_REALM || "api-center"}/protocol/openid-connect/certs`,
    tokenEndpoint: process.env.KEYCLOAK_TOKEN_ENDPOINT || "",
    issuer: process.env.KEYCLOAK_ISSUER || "",
    audience: process.env.KEYCLOAK_AUDIENCE || "",
    refreshClientId: process.env.KEYCLOAK_REFRESH_CLIENT_ID || "api-center",
    defaultClientSecret: process.env.KEYCLOAK_DEFAULT_CLIENT_SECRET || "",
    /**
     * When true, trust X-Forwarded-User / X-Forwarded-Roles injected by
     * Envoy/Ingress after edge JWT pre-verification. ONLY enable when the
     * gateway is behind a trusted ingress — never direct internet exposure.
     */
    trustEnvoyHeaders: process.env.ENVOY_TRUST_HEADERS === "true",
  };

  readonly descope = {
    baseUrl: this.descopeBaseUrl,
    projectId: this.descopeProjectId,
    jwksUri:
      process.env.DESCOPE_JWKS_URI ||
      (this.descopeProjectId
        ? `${this.descopeBaseUrl}/${this.descopeProjectId}/.well-known/jwks.json`
        : ""),
    tokenEndpoint:
      process.env.DESCOPE_TOKEN_ENDPOINT ||
      `${this.descopeBaseUrl}/oauth2/v1/token`,
    issuer: process.env.DESCOPE_ISSUER || "",
    audience: process.env.DESCOPE_AUDIENCE || "",
    refreshClientId: process.env.DESCOPE_REFRESH_CLIENT_ID || "api-center",
    defaultClientSecret: process.env.DESCOPE_DEFAULT_CLIENT_SECRET || "",
  };

  readonly devJwt = {
    issuer: process.env.DEV_JWT_ISSUER || "api-center-dev",
    tokenTtlSeconds: parseInt(process.env.DEV_JWT_TTL_SECONDS || "3600", 10),
    refreshTtlMultiplier: parseInt(
      process.env.DEV_JWT_REFRESH_TTL_MULTIPLIER || "24",
      10,
    ),
  };

  // HashiCorp Vault — KV v2 secret loading + Transit signing
  readonly vault = {
    addr: process.env.VAULT_ADDR || "http://localhost:8200",
    token: process.env.VAULT_TOKEN || "",
    roleId: process.env.VAULT_ROLE_ID || "",
    secretId: process.env.VAULT_SECRET_ID || "",
    secretPath: process.env.VAULT_SECRET_PATH || "secret/api-center",
    transitKey: process.env.VAULT_TRANSIT_KEY || "",
    devMode: process.env.VAULT_DEV_MODE === "true",
  };

  readonly kafka = {
    clientId: process.env.KAFKA_CLIENT_ID || "api-center",
    brokers: (process.env.KAFKA_BROKERS || "")
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    groupId: process.env.KAFKA_GROUP_ID || "api-center-group",
    sslEnabled: process.env.KAFKA_SSL_ENABLED === "true",
    sslRejectUnauthorized:
      process.env.KAFKA_SSL_REJECT_UNAUTHORIZED !== "false",
    sslCaPem: process.env.KAFKA_SSL_CA_PEM || "",
    saslMechanism: process.env.KAFKA_SASL_MECHANISM || "",
    saslUsername: process.env.KAFKA_SASL_USERNAME || "",
    saslPassword: process.env.KAFKA_SASL_PASSWORD || "",
  };

  get platformAdminSecret(): string {
    return process.env.PLATFORM_ADMIN_SECRET || "";
  }

  readonly redis = {
    rateLimitUrl: process.env.REDIS_RATE_LIMIT_URL || "redis://localhost:6380",
    cacheUrl: process.env.REDIS_CACHE_URL || "redis://localhost:6381",
    tokenTtlSeconds: parseInt(
      process.env.REDIS_TOKEN_TTL_SECONDS || "3600",
      10,
    ),
    sessionTtlSeconds: parseInt(
      process.env.REDIS_SESSION_TTL_SECONDS || "86400",
      10,
    ),
  };

  readonly registryBootstrap = {
    enabled: process.env.REGISTRY_BOOTSTRAP_ENABLED === "true",
    allowInProduction:
      process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION === "true",
    manifestPaths: this.parseRegistryBootstrapManifestPaths(),
  };

  readonly rateLimit = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  };

  readonly health = {
    checkTimeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || "5000", 10),
  };

  readonly external = {
    timeout: 10000,
  };

  readonly tracing = {
    otlpTracesEndpoint:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      process.env.JAEGER_ENDPOINT ||
      "http://localhost:4318/v1/traces",
    serviceName: process.env.OTEL_SERVICE_NAME || "api-center",
  };

  readonly allowedOrigins: string | string[] = this.cors.origin;

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  onApplicationBootstrap() {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!this.platformAdminSecret && this.isProduction) {
      errors.push("PLATFORM_ADMIN_SECRET must be set in production");
    }

    const validProviders = ["keycloak", "descope", "google", "dev-jwt"];
    if (!validProviders.includes(this.authProvider)) {
      errors.push(
        `AUTH_PROVIDER must be one of: ${validProviders.join(", ")} (got '${this.authProvider}')`,
      );
    }

    if (this.authProvider === "keycloak") {
      const isLocalhost = (() => {
        try {
          return new URL(this.keycloak.baseUrl).hostname === "localhost";
        } catch {
          return false;
        }
      })();
      if (isLocalhost && this.isProduction)
        errors.push(
          "KEYCLOAK_BASE_URL must be set to a production Keycloak URL",
        );
      if (isLocalhost && !this.isProduction)
        warnings.push("KEYCLOAK_BASE_URL still points to localhost");
      if (!this.keycloak.issuer && this.isProduction)
        warnings.push(
          "KEYCLOAK_ISSUER is not set — token issuer validation is disabled",
        );
      if (this.keycloak.trustEnvoyHeaders)
        warnings.push(
          "ENVOY_TRUST_HEADERS=true — ensure this gateway is never directly internet-exposed",
        );
    }

    if (this.authProvider === "descope") {
      const isLocalhost = (() => {
        try {
          return new URL(this.descope.baseUrl).hostname === "localhost";
        } catch {
          return false;
        }
      })();

      if (!this.descope.jwksUri)
        errors.push(
          "DESCOPE_JWKS_URI (or DESCOPE_PROJECT_ID) must be set for AUTH_PROVIDER=descope",
        );
      if (!this.descope.tokenEndpoint)
        errors.push(
          "DESCOPE_TOKEN_ENDPOINT must be set for AUTH_PROVIDER=descope",
        );
      if (isLocalhost && this.isProduction)
        errors.push("DESCOPE_BASE_URL must be set to a production Descope URL");
      if (!this.descope.issuer && this.isProduction)
        errors.push(
          "DESCOPE_ISSUER must be set in production for token issuer validation",
        );
      if (!this.descope.audience && this.isProduction)
        errors.push(
          "DESCOPE_AUDIENCE must be set in production for token audience validation",
        );
      if (!this.descope.defaultClientSecret && this.isProduction) {
        warnings.push(
          "DESCOPE_DEFAULT_CLIENT_SECRET is not set — ensure DESCOPE_CLIENT_SECRET_<SERVICE_ID> is configured for each service",
        );
      }
    }

    if (this.authProvider === "google") {
      if (!this.google.clientId)
        warnings.push("GOOGLE_CLIENT_ID is not set — Google auth will fail");
      if (!this.google.clientSecret)
        warnings.push(
          "GOOGLE_CLIENT_SECRET is not set — Google auth will fail",
        );
      if (this.google.allowedDomains.length === 0 && this.isProduction) {
        warnings.push(
          "GOOGLE_ALLOWED_DOMAINS is not set in production — any Google account can authenticate",
        );
      }
      if (this.google.allowedRedirectOrigins.length === 0) {
        const msg =
          "GOOGLE_ALLOWED_REDIRECT_URIS is not set or invalid — Google redirect URIs cannot be validated";
        if (this.isProduction) {
          errors.push(msg);
        } else {
          warnings.push(msg);
        }
      }
    }

    if (this.authProvider === "dev-jwt" && this.isProduction) {
      errors.push(
        "AUTH_PROVIDER=dev-jwt must NOT be used in production. Use AUTH_PROVIDER=descope, keycloak, or google",
      );
    }

    if (this.isProduction) {
      const configuredOrigins = Array.isArray(this.cors.origin)
        ? this.cors.origin
        : [this.cors.origin];
      if (configuredOrigins.includes("*")) {
        errors.push(
          "ALLOWED_ORIGINS must list explicit origins in production; wildcard (*) is not allowed",
        );
      }
    }

    if (
      this.registryBootstrap.enabled &&
      this.registryBootstrap.manifestPaths.length === 0
    ) {
      errors.push(
        "REGISTRY_BOOTSTRAP_MANIFESTS must include at least one manifest path when REGISTRY_BOOTSTRAP_ENABLED=true",
      );
    }

    if (
      this.registryBootstrap.enabled &&
      this.isProduction &&
      !this.registryBootstrap.allowInProduction
    ) {
      errors.push(
        "REGISTRY_BOOTSTRAP_ENABLED=true is blocked in production unless REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION=true",
      );
    }

    if (
      this.registryBootstrap.enabled &&
      !this.isProduction &&
      this.registryBootstrap.allowInProduction
    ) {
      warnings.push(
        "REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION=true is set in non-production; this override is unnecessary",
      );
    }

    if (
      !Number.isFinite(this.health.checkTimeoutMs) ||
      this.health.checkTimeoutMs < 100
    ) {
      errors.push(
        "HEALTH_CHECK_TIMEOUT_MS must be a number greater than or equal to 100",
      );
    }

    if (this.vault.devMode && this.isProduction) {
      errors.push("VAULT_DEV_MODE=true must NOT be used in production");
    }

    if (this.isProduction && !this.vault.token && !this.vault.roleId) {
      warnings.push(
        "No Vault credentials configured — secrets read from process.env only. Set VAULT_ROLE_ID+VAULT_SECRET_ID for production.",
      );
    }

    const validKafkaSaslMechanisms = [
      "plain",
      "scram-sha-256",
      "scram-sha-512",
    ];
    if (
      this.kafka.saslMechanism &&
      !validKafkaSaslMechanisms.includes(this.kafka.saslMechanism)
    ) {
      errors.push(
        `KAFKA_SASL_MECHANISM must be one of: ${validKafkaSaslMechanisms.join(", ")} (got '${this.kafka.saslMechanism}')`,
      );
    }

    if (this.isProduction) {
      const hasLocalOrSelfManagedBroker = this.kafka.brokers.some((broker) => {
        const normalizedBroker = broker.toLowerCase();
        return (
          normalizedBroker.includes("localhost") ||
          normalizedBroker.includes("kafka:") ||
          normalizedBroker.includes("api-center-kafka") ||
          normalizedBroker.includes(".svc.cluster.local")
        );
      });
      const allBrokersAreConfluentCloud = this.kafka.brokers.every((broker) =>
        /^[a-z0-9-]+(\.[a-z0-9-]+)*\.confluent\.cloud:9092$/i.test(broker),
      );

      if (this.kafka.brokers.length === 0) {
        errors.push(
          "KAFKA_BROKERS must be set for Confluent Cloud in production",
        );
      } else if (hasLocalOrSelfManagedBroker || !allBrokersAreConfluentCloud) {
        errors.push(
          "KAFKA_BROKERS must point to Confluent Cloud in production",
        );
      }

      if (!this.kafka.sslEnabled) {
        errors.push("KAFKA_SSL_ENABLED=true is required for Confluent Cloud");
      }

      if (this.kafka.saslMechanism !== "plain") {
        errors.push(
          "KAFKA_SASL_MECHANISM=plain is required for Confluent Cloud",
        );
      }
    }

    if (
      this.kafka.saslMechanism &&
      (!this.kafka.saslUsername || !this.kafka.saslPassword)
    ) {
      const message =
        "KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD must be set when KAFKA_SASL_MECHANISM is configured";
      if (this.isProduction) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }

    if (this.isProduction && !this.kafka.sslEnabled) {
      warnings.push(
        "KAFKA_SSL_ENABLED is false in production — TLS is strongly recommended",
      );
    }

    if (
      this.isProduction &&
      this.kafka.sslEnabled &&
      !this.kafka.sslRejectUnauthorized
    ) {
      warnings.push(
        "KAFKA_SSL_REJECT_UNAUTHORIZED=false disables broker certificate verification in production",
      );
    }

    if (
      this.isProduction &&
      this.kafka.sslEnabled &&
      this.kafka.sslRejectUnauthorized &&
      !this.kafka.sslCaPem
    ) {
      warnings.push(
        "KAFKA_SSL_CA_PEM is not set while TLS verification is enabled — self-signed broker certificates may fail verification",
      );
    }

    if (this.isProduction) {
      if (this.redis.rateLimitUrl.includes("localhost"))
        warnings.push(
          "REDIS_RATE_LIMIT_URL still points to localhost in production",
        );
      if (this.redis.cacheUrl.includes("localhost"))
        warnings.push(
          "REDIS_CACHE_URL still points to localhost in production",
        );
    }

    for (const w of warnings) console.warn(`[ConfigService] WARNING: ${w}`);

    if (errors.length > 0) {
      const msg = `[ConfigService] Fatal configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  private parseGoogleAllowedRedirectOrigins(): string[] {
    const configuredUris = (process.env.GOOGLE_ALLOWED_REDIRECT_URIS ?? "")
      .split(",")
      .map((uri) => uri.trim())
      .filter(Boolean);

    const origins = configuredUris
      .map((uri) => {
        try {
          return new URL(uri).origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean);

    return [...new Set(origins)];
  }

  private parseAllowedOrigins(): string | string[] {
    const rawOrigins = process.env.ALLOWED_ORIGINS;
    if (!rawOrigins || rawOrigins.trim() === "*") {
      return "*";
    }

    const parsedOrigins = rawOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

    return parsedOrigins.length > 0 ? parsedOrigins : "*";
  }

  private parseRegistryBootstrapManifestPaths(): string[] {
    const rawManifestPaths = process.env.REGISTRY_BOOTSTRAP_MANIFESTS;
    if (!rawManifestPaths || rawManifestPaths.trim().length === 0) {
      return [...DEFAULT_REGISTRY_BOOTSTRAP_MANIFESTS];
    }

    const parsed = rawManifestPaths
      .split(",")
      .map((manifestPath) => manifestPath.trim())
      .filter(Boolean);

    return [...new Set(parsed)];
  }
}
