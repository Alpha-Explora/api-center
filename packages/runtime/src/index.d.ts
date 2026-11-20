import { Express, Request, Response } from 'express';

export interface SharedServiceAppOptions {
  serviceId: string;
  health?: Record<string, unknown>;
  jsonOptions?: Record<string, unknown>;
}

export interface SharedServiceApp {
  app: Express;
  ok: (res: Response, data?: unknown, statusCode?: number) => void;
  fail: (res: Response, statusCode: number, code: string, message: string, details?: unknown) => void;
}

export interface IdempotencyStore {
  claim: (key: string, body: unknown, options?: { leaseMs?: number }) => Promise<IdempotencyClaim>;
  complete: (key: string, body: unknown, response: IdempotencyResponse, options?: { ttlMs?: number }) => Promise<void>;
  markUnknown: (key: string, body: unknown) => Promise<void>;
  release: (key: string, body: unknown) => Promise<void>;
}

export type IdempotencyResponse = { status: number; body: unknown };
export type IdempotencyClaim =
  | { status: 'claimed' | 'in_progress' | 'unknown' | 'payload_mismatch' }
  | { status: 'replay'; response: IdempotencyResponse };

export interface ScopedIdempotencyKeyOptions {
  namespace: string;
  route: string;
  clientKey?: string;
  sourceServiceId?: string;
  tribeId?: string;
  environment?: string;
}

export interface RateLimitStore {
  consume: (key: string, options: { limit: number; windowMs: number }) => Promise<{ allowed: boolean; resetAt: number }>;
}

export interface CacheStore {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any, options?: { ttlMs?: number }) => Promise<void>;
}

export interface CircuitBreaker {
  exec: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function createSharedServiceApp(options: SharedServiceAppOptions): SharedServiceApp;
/** Create the exact success envelope used by the shared-service response helper. */
export function createSuccessResponse(data: unknown, status?: number): IdempotencyResponse;
/** Create the exact error envelope used by the shared-service response helper. */
export function createFailureResponse(status: number, code: string, message: string, details?: unknown): IdempotencyResponse;
/** Create an in-memory idempotency store for local development and tests. */
export function createMemoryIdempotencyStore(options?: { now?: () => number }): IdempotencyStore;
/** Hash an idempotency key together with its trusted consumer and operation scope. */
export function createScopedIdempotencyKey(options: ScopedIdempotencyKeyOptions): string | null;
export function createMemoryRateLimitStore(): RateLimitStore;
/** A per-recipient rate-limit key, normalised and scoped to the caller's project and environment. */
export function recipientRateLimitKey(
  namespace: string,
  caller: Pick<SharedServiceCaller, 'projectId' | 'environment'>,
  recipient: unknown,
): string;
/** Where a runtime keeps shared state: its database and its own `shared_*` schema. */
export interface SharedStoreOptions { databaseUrl?: string; schema: string }
/** Idempotency claims in `<schema>.idempotency_keys`; production requires a database URL. */
export function createSharedIdempotencyStore(options: SharedStoreOptions): IdempotencyStore;
/** Fixed-window limits in `<schema>.rate_limit_windows`; production requires a database URL. */
export function createSharedRateLimitStore(options: SharedStoreOptions): RateLimitStore;
/** Send an SMS through Twilio and return its APICenter delivery status. */
export function sendTwilioSms(input: { to: string; message: string; senderId?: string; statusCallback?: string }): Promise<{ messageId: string; status: 'queued' | 'sent' | 'delivered' | 'failed' }>;
/**
 * Send an email through Resend and return its APICenter delivery status. `fromName` is shown as the
 * sender's name in front of EMAIL_FROM_ADDRESS; `html` is sent alongside the plain text.
 */
export function sendResendEmail(input: { to: string; subject: string; text: string; html?: string; fromName?: string }): Promise<{ messageId: string; status: 'queued' }>;
/** `"Name" <address>` for a From header, or the bare address when no usable name is given. */
export function formatSender(address: string, name?: string): string;
export function createMemoryCacheStore(): CacheStore;
export function createCircuitBreaker(options: { provider: string; failureThreshold?: number; resetAfterMs?: number }): CircuitBreaker;
export function withProviderTimeout<T>(promise: Promise<T>, options: { timeoutMs: number; provider: string; operation: string }): Promise<T>;
export function recordProviderMetric(metric: { serviceId: string; provider: string; operation: string; status: string; latencyMs: number }): void;

export interface SharedServiceCaller {
  /** The organization that owns the caller's records. */
  tribeId: string;
  projectId: string;
  /** The application ID. */
  serviceId: string;
  environment: 'test' | 'live';
  /** `application` for a gateway-signed call; `local` for a direct call outside production. */
  model: 'application' | 'local';
  organizationId?: string;
  environmentId?: string;
  applicationId?: string;
  action?: string;
  requestId?: string;
  /** Set by the gateway for a test send to an unregistered recipient: record it, deliver nothing. */
  suppressDelivery?: boolean;
  /** The project's display name, from the signed context. Absent for local callers and older gateways. */
  projectName?: string;
}

export class SharedServiceCallerError extends Error {}

export const RUNTIME_CONTEXT_HEADER: 'X-APICenter-Context';

/**
 * Reads the gateway-authenticated caller from the signed `X-APICenter-Context`, verified against
 * `runtimeAudience`. Production requires it; outside production a call without one is `local`.
 */
export function readSharedServiceCaller(
  req: { get(name: string): string | undefined },
  options?: {
    production?: boolean;
    runtimeAudience?: string;
    contextKeys?: Map<string, unknown>;
    now?: number;
  },
): SharedServiceCaller;

export class RuntimeContextError extends Error {}

/** The verified application context, or undefined when none was sent. An invalid one throws. */
export function readRuntimeApplicationContext(
  req: { get(name: string): string | undefined },
  options?: { runtimeAudience?: string; contextKeys?: Map<string, unknown>; now?: number },
): RuntimeContextClaims | undefined;

/** Identity fields for createScopedIdempotencyKey, from the caller. */
export function callerIdempotencyScope(
  caller: SharedServiceCaller,
): { sourceServiceId?: string; tribeId?: string; environment?: string };

/** Express middleware: a present signed context must verify for this runtime or the request gets 403. */
export function createRuntimeContextGate(
  runtimeAudience: string,
  options?: { production?: boolean },
): (req: any, res: any, next: () => void) => void;

export interface RuntimeContextClaims {
  requestId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  environmentKind: 'test' | 'live';
  applicationId: string;
  action: string;
  /** The owner group records are scoped to (organization ID unless the project was migrated). */
  ownerGroupId: string;
  ownerProjectId: string;
  /** A test send whose recipient the project has not registered: record it and deliver nothing. */
  suppressDelivery: boolean;
  /** The project's display name (one line, at most 80 characters), when the gateway sent it. */
  projectName?: string;
}

/** Parses an Ed25519 public JWK array (APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS by default). */
export function loadRuntimeContextKeys(raw?: string): Map<string, unknown>;

export function verifyRuntimeContext(
  token: string,
  options: {
    audience: string;
    keys: Map<string, unknown>;
    now?: number;
    maxLifetimeSeconds?: number;
    clockSkewSeconds?: number;
  },
): RuntimeContextClaims;

/** True when both callers share a project and environment. Any service in that project can read the records. */
export function sameProject(left: SharedServiceCaller, right: SharedServiceCaller): boolean;
export function ok(res: Response, data?: unknown, statusCode?: number): void;
export function fail(res: Response, statusCode: number, code: string, message: string, details?: unknown): void;
