// =============================================================================
// src/types/index.ts â€” Shared TypeScript type definitions for the API Center
// =============================================================================
// All shared interfaces and types used across the application are defined here.
// Import from '../types' in other modules.
//
// NESTJS NOTE: In NestJS, we use DTOs (Data Transfer Objects) with
// class-validator decorators for request validation instead of Zod.
// However, these interfaces remain useful for internal typing.
// =============================================================================

import { Request } from "express";
import type { JwtClaims } from "@auth/auth-provider.interface";
import type { PaymentPrincipal } from "../domains/payments";

// ---------------------------------------------------------------------------
// Express request extensions (used inside NestJS's Express adapter)
// ---------------------------------------------------------------------------

/**
 * Extended Express Request that includes service authentication info
 * and distributed tracing fields.
 * After JwtAuthGuard validates the Bearer JWT, these fields are attached.
 * The user field now carries the provider-agnostic JwtClaims (not Descope-specific).
 */
export interface AuthenticatedRequest extends Request {
  /** Normalised JWT claims attached by JwtAuthGuard after token validation */
  user?: JwtClaims;
  /** Tribe that owns the calling service (derived from its project when the token was issued) */
  tribeId?: string;
  /** Project the calling service belongs to */
  projectId?: string;
  /** The calling service. Bound to the credential that minted the token; never caller-selected. */
  sourceServiceId?: string;
  /** Unique correlation ID for distributed request tracing */
  correlationId?: string;
  paymentPrincipal?: PaymentPrincipal;
}

// ---------------------------------------------------------------------------
// Authentication types
// ---------------------------------------------------------------------------

/** Response returned when a service token is successfully issued */
export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  serviceId: string;
  projectId: string;
  tribeId: string;
  permissions: string[];
  scopes: string[];
}

// ---------------------------------------------------------------------------
// Service Registry types (Dynamic Service Registry)
// ---------------------------------------------------------------------------

/** Service tier determines SLA expectations and priority in the platform */
export type ServiceTier = "critical" | "standard" | "experimental";

/** Lifecycle status for governed service management */
export type ServiceLifecycleStatus =
  | "proposed" // Submitted but not yet approved for traffic
  | "active" // Live and serving traffic
  | "deprecated" // Still live but consumers should migrate
  | "retired"; // No longer routable â€” kept for audit history

/** Routing namespace: shared = platform service, tribe = tribe backend */
export type ServiceType = "shared" | "tribe";

export const APICENTER_RUNTIME_ENVIRONMENT_KEYS = ["test", "live"] as const;

export type ApicenterRuntimeEnvironment = (typeof APICENTER_RUNTIME_ENVIRONMENT_KEYS)[number];

export function isApicenterRuntimeEnvironment(value: unknown): value is ApicenterRuntimeEnvironment {
  return (
    typeof value === "string" &&
    APICENTER_RUNTIME_ENVIRONMENT_KEYS.includes(value as ApicenterRuntimeEnvironment)
  );
}

// Token issuance, gateway routing, provider routing, usage, quota, and evidence
// use ApicenterRuntimeEnvironment. The broader ServiceEnvironmentKey remains
// while migrating existing staging/uat/demo registry rows.
/** Platform-approved runtime environments for one stable service identity */
export type ServiceEnvironmentKey =
  | "test"
  | "staging"
  | "uat"
  | "demo"
  | "live";

export interface ServiceEnvironmentManifest {
  environment: ServiceEnvironmentKey;
  baseUrl: string;
  healthCheck?: string;
  status?: ServiceLifecycleStatus;
  healthy?: boolean;
  lastHealthCheckAt?: string;
}

/**
 * A service manifest is what a service sends when registering with the API Center.
 * Tribe-type services name the project they belong to; the owning tribe is derived from that project.
 * Shared platform services have no project.
 */
export interface ServiceManifest {
  serviceId: string;
  name: string;
  baseUrl: string;
  requiredScopes: string[];
  exposes: string[];
  consumes: string[];
  /** Project that owns this service. Required for tribe services, forbidden for shared services. */
  projectId?: string;
  /** Routing namespace â€” 'shared' for platform services, 'tribe' for tribe backends. Defaults to 'tribe'. */
  serviceType?: ServiceType;
  healthCheck?: string;
  environments?: ServiceEnvironmentManifest[];
  version?: string;
  description?: string;
  tags?: string[];

  // â”€â”€ Governance fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /** Team or squad that owns and operates this service */
  ownerTeam?: string;
  /** Primary contact email / Slack channel for incidents */
  contact?: string;
  /** SLA tier: critical (99.9 %), standard (99.5 %), experimental (best-effort) */
  serviceTier?: ServiceTier;
  /** Internal cost centre for showback / chargeback attribution */
  costCenter?: string;
  /** ISO-8601 date after which the service is considered deprecated */
  sunsetDate?: string;
  /** serviceId of the replacement service consumers should migrate to */
  replacementService?: string;
  apiProductName?: string;
  apiProductDescription?: string;
  slaTier?: string;
  supportChannel?: string;
  documentationUrl?: string;
  providerCostSensitive?: boolean;
}

/**
 * A registry entry extends ServiceManifest with platform-managed metadata.
 */
export interface ServiceRegistryEntry extends ServiceManifest {
  /** Tribe that owns this service, derived from projectId at registration. Never accepted from callers. */
  ownerTribeId?: string;
  registeredAt: string;
  updatedAt: string;
  status: ServiceLifecycleStatus;
  environments: ServiceEnvironmentManifest[];
  /** Previous version string â€” set on update when version changes */
  previousVersion?: string;
  /** Runtime health â€” `true` (default) when the upstream responds to health checks */
  healthy?: boolean;
  /** ISO-8601 timestamp of the last successful or failed health check */
  lastHealthCheckAt?: string;
}

/** Map of service ID â†’ ServiceRegistryEntry */
export interface ServiceRegistryMap {
  [serviceId: string]: ServiceRegistryEntry;
}

// ---------------------------------------------------------------------------
// External API types
// ---------------------------------------------------------------------------

export type ExternalAuthType =
  | "bearer"
  | "api-key"
  | "basic"
  | "apiKey"
  | "none";

export interface ExternalApiConfig {
  name: string;
  displayName: string;
  baseUrl: string;
  authType: ExternalAuthType;
  authHeader?: string;
  authValue?: string;
  timeout: number;
  rateLimit?: { windowMs: number; max: number };
  healthEndpoint?: string;
  description?: string;
}

export interface ExternalApiConfigMap {
  [apiName: string]: ExternalApiConfig;
}

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface ExternalCallOptions {
  method?: HttpMethod;
  path?: string;
  query?: Record<string, string>;
  body?: unknown;
  data?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  tribeId?: string;
  correlationId?: string;
  paymentPrincipal?: PaymentPrincipal;
}

// ---------------------------------------------------------------------------
// Kafka types
// ---------------------------------------------------------------------------

export interface KafkaMessageMeta {
  timestamp: string;
  source: string;
  correlationId?: string;
  paymentPrincipal?: PaymentPrincipal;
}

export interface AuditLogEvent {
  tribeId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip: string;
  correlationId?: string;
  paymentPrincipal?: PaymentPrincipal;
}

// ---------------------------------------------------------------------------
// API Response envelope (standardized response shape)
// ---------------------------------------------------------------------------

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    correlationId?: string;
  };
}

