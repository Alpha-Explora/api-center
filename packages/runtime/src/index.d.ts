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
/** Create a shared Redis-backed idempotency store; production requires a Redis URL. */
export function createSharedIdempotencyStore(options: { url?: string; namespace: string }): IdempotencyStore;
/** Create a shared Redis-backed rate limiter; production requires a Redis URL. */
export function createSharedRateLimitStore(options: { url?: string; namespace: string }): RateLimitStore;
/** Send an SMS through Twilio and return its APICenter delivery status. */
export function sendTwilioSms(input: { to: string; message: string; senderId?: string }): Promise<{ messageId: string; status: 'queued' | 'sent' | 'delivered' | 'failed' }>;
/** Send a plain-text email through Resend and return its APICenter delivery status. */
export function sendResendEmail(input: { to: string; subject: string; text: string }): Promise<{ messageId: string; status: 'queued' }>;
export function createMemoryCacheStore(): CacheStore;
export function createCircuitBreaker(options: { provider: string; failureThreshold?: number; resetAfterMs?: number }): CircuitBreaker;
export function withProviderTimeout<T>(promise: Promise<T>, options: { timeoutMs: number; provider: string; operation: string }): Promise<T>;
export function recordProviderMetric(metric: { serviceId: string; provider: string; operation: string; status: string; latencyMs: number }): void;

export function registerWithGateway(options: {
  manifestPath: string;
  baseUrl?: string;
  serviceLabel?: string;
}): Promise<unknown>;

export function shouldRegisterWithGateway(): boolean;

export interface SharedServiceCaller {
  tribeId: string;
  projectId: string;
  serviceId: string;
  environment: 'test' | 'live';
}

export class SharedServiceCallerError extends Error {}

/** Reads the gateway-authenticated caller. Production rejects a request that lacks any caller header. */
export function readSharedServiceCaller(
  req: { get(name: string): string | undefined },
  options?: { production?: boolean },
): SharedServiceCaller;

/** True when both callers share a project and environment. Any service in that project can read the records. */
export function sameProject(left: SharedServiceCaller, right: SharedServiceCaller): boolean;
export function ok(res: Response, data?: unknown, statusCode?: number): void;
export function fail(res: Response, statusCode: number, code: string, message: string, details?: unknown): void;
