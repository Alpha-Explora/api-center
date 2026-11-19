// One HTTPS call to APICenter: the application key, a per-attempt timeout, retries for failures
// that are safe to repeat, an idempotency key on every write (reused across those retries), and
// typed errors. Uses only fetch and Web APIs, so it runs on Node, Deno, Bun and edge runtimes.
import { ApiCenterError, ConnectionError, errorFor } from './errors.js';
import type { RequestHooks, RequestOptions } from '../types.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

export interface ApiRequest {
  path: string;
  method: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** A write carries an Idempotency-Key, generated unless the caller supplied one. */
  write?: boolean;
  idempotencyKey?: string;
  options?: RequestOptions;
}

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  hooks?: RequestHooks;
  sdkVersion: string;
}

export const APPLICATION_KEY = /^ak_(test|live)_[a-z0-9]{16}_[A-Za-z0-9_-]{43}$/;
/** The API version this SDK was built against; sent on every request. */
export const API_VERSION = '2026-11-19';

const MANAGED_HEADERS = new Set(['authorization', 'idempotency-key', 'apicenter-version', 'apicenter-sdk', 'x-apicenter-context']);
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_SECONDS = 20;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bak_(test|live)_[A-Za-z0-9_-]+/g, 'ak_$1_[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*\b/g, '[REDACTED]')
    .replace(
      /\b(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|secret|authorization)\b\s*([:=])\s*("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
      '$1$2[REDACTED]',
    );
}

function sanitizeErrorDetails(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (depth >= 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeErrorDetails(item, depth + 1));
  const record = objectValue(value);
  if (!record) return undefined;
  const sensitiveKey = /authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|secret|credential|cookie/i;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !sensitiveKey.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, sanitizeErrorDetails(item, depth + 1)]),
  );
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class ApiCenterTransport {
  readonly environment: 'test' | 'live';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly hooks: RequestHooks;
  private readonly sdkVersion: string;

  constructor(options: TransportOptions) {
    const apiKey = options.apiKey.trim();
    const match = APPLICATION_KEY.exec(apiKey);
    if (!match) throw new TypeError('apiKey must be an APICenter application key (ak_test_… or ak_live_…)');
    this.apiKey = apiKey;
    this.environment = match[1] as 'test' | 'live';
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive number');
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 10) throw new TypeError('maxRetries must be an integer from 0 to 10');
    this.hooks = options.hooks ?? {};
    this.sdkVersion = options.sdkVersion;
  }

  async request<T>(request: ApiRequest): Promise<T> {
    const signal = request.options?.signal;
    if (signal?.aborted) throw abortError(signal);

    const headers = new Headers({ Accept: 'application/json' });
    for (const [name, value] of Object.entries(request.options?.headers ?? {})) {
      if (MANAGED_HEADERS.has(name.toLowerCase())) throw new TypeError(`The ${name} header is managed by the APICenter SDK`);
      headers.set(name, value);
    }
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('APICenter-Version', API_VERSION);
    headers.set('APICenter-SDK', `apicenter-sdk-js/${this.sdkVersion}`);
    if (request.body !== undefined) headers.set('Content-Type', 'application/json');

    let idempotencyKey: string | undefined;
    if (request.write) {
      const key = (request.idempotencyKey ?? `sdk_${globalThis.crypto.randomUUID()}`).trim();
      if (key.length < 16 || key.length > 255) throw new TypeError('idempotencyKey must be between 16 and 255 characters');
      headers.set('Idempotency-Key', key);
      idempotencyKey = key;
    }

    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) query.set(key, String(value));
    const url = `${this.baseUrl}${request.path}${query.size ? `?${query}` : ''}`;
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    const timeoutMs = request.options?.timeoutMs ?? this.timeoutMs;

    for (let attempt = 1; ; attempt += 1) {
      this.hooks.onRequest?.({ method: request.method, url, attempt, idempotencyKey });
      const started = Date.now();
      let error: ApiCenterError;
      try {
        const response = await this.send(url, request.method, headers, body, timeoutMs, signal);
        const text = await response.text();
        const result = this.decode<T>(response, text);
        this.hooks.onResponse?.({ method: request.method, url, attempt, status: response.status, durationMs: Date.now() - started, requestId: this.requestId(response) });
        return result;
      } catch (caught) {
        if (signal?.aborted) throw abortError(signal);
        if (!(caught instanceof ApiCenterError)) throw caught;
        error = caught;
        this.hooks.onResponse?.({ method: request.method, url, attempt, status: error.status, durationMs: Date.now() - started, requestId: error.requestId, error });
      }
      const delay = this.retryDelay(error, attempt);
      if (delay === undefined) throw error;
      await sleep(delay, signal);
    }
  }

  /** Milliseconds to wait before retrying, or undefined when the failure should be returned. */
  private retryDelay(error: ApiCenterError, attempt: number): number | undefined {
    if (attempt > this.maxRetries) return undefined;
    const retryable = error instanceof ConnectionError || RETRYABLE_STATUS.has(error.status);
    if (!retryable || error.code === 'QUOTA_EXCEEDED') return undefined;
    if (error.retryAfterSeconds !== undefined) {
      return error.retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS ? error.retryAfterSeconds * 1000 : undefined;
    }
    const base = Math.min(8000, 500 * 2 ** (attempt - 1));
    return base / 2 + Math.random() * (base / 2);
  }

  private async send(url: string, method: HttpMethod, headers: Headers, body: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await this.fetchImpl(url, { method, headers, signal: combined, ...(body === undefined ? {} : { body }) });
    } catch (cause) {
      if (signal?.aborted) throw abortError(signal);
      if (timeout.aborted) {
        throw new ConnectionError(`APICenter did not answer within ${timeoutMs} ms`, { status: 0, code: 'REQUEST_TIMEOUT', cause });
      }
      throw new ConnectionError('Could not reach APICenter', { status: 0, code: 'NETWORK_ERROR', cause });
    }
  }

  private decode<T>(response: Response, text: string): T {
    if (!text.trim() && response.status === 204) return undefined as T;
    const requestId = this.requestId(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw errorFor(text.trim() ? `APICenter returned invalid JSON (${response.status})` : `APICenter returned an empty response (${response.status})`, {
        status: response.status,
        code: text.trim() ? 'INVALID_JSON' : 'EMPTY_RESPONSE',
        requestId,
        retryAfterSeconds: retryAfterSeconds(response),
      });
    }
    const envelope = objectValue(payload);
    const apiError = objectValue(envelope?.error);
    const meta = objectValue(envelope?.meta);
    const id = stringValue(meta?.correlationId) ?? requestId;
    if ((response.ok || response.status === 202) && envelope?.success === true && Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      return envelope.data as T;
    }
    const message = response.status >= 500
      ? `APICenter returned an error (${response.status})`
      : redactSensitiveText(stringValue(apiError?.message) ?? stringValue(envelope?.message) ?? `APICenter request failed (${response.status})`);
    throw errorFor(message, {
      status: response.status,
      code: stringValue(apiError?.code) ?? stringValue(envelope?.code),
      details: response.status >= 500 ? undefined : sanitizeErrorDetails(apiError?.details),
      requestId: id,
      retryAfterSeconds: retryAfterSeconds(response),
    });
  }

  private requestId(response: Response): string | undefined {
    return response.headers.get('x-apicenter-correlation-id') ?? response.headers.get('x-correlation-id') ?? undefined;
  }
}
