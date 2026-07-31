import { Express, Request, Response } from 'express';

export interface SharedServiceAppOptions {
  serviceId: string;
  health?: Record<string, unknown>;
}

export interface SharedServiceApp {
  app: Express;
  ok: (res: Response, data?: unknown, statusCode?: number) => void;
  fail: (res: Response, statusCode: number, code: string, message: string, details?: unknown) => void;
}

export interface IdempotencyStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, options?: { ttlMs?: number }) => Promise<void>;
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
export function createMemoryIdempotencyStore(): IdempotencyStore;
export function createMemoryRateLimitStore(): RateLimitStore;
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
export function ok(res: Response, data?: unknown, statusCode?: number): void;
export function fail(res: Response, statusCode: number, code: string, message: string, details?: unknown): void;
