import { ApiCenterError } from './errors';
import { ServiceTokenProvider, type IssuedServiceToken, type ServiceCredentials, type TokenEndpointRequest } from './auth/service-token-provider';
import type { AccessTokenProvider, ApiCenterAuth, RequestOptions } from '../types';

export type ApiCredential = 'service' | 'payment' | 'none';
export type HttpMethod = 'GET' | 'POST' | 'PATCH';

export interface ApiRequest<TBody = unknown> {
  path: string;
  method: HttpMethod;
  credential: ApiCredential;
  body?: TBody;
  options?: RequestOptions;
  idempotencyKey?: string;
}

export interface ApiCenterTransportOptions {
  baseUrl: string;
  auth?: ApiCenterAuth;
  paymentApiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const protectedHeaders = new Set([
  'authorization',
  'idempotency-key',
  'x-tribe-id',
  'x-apicenter-tribe-id',
  'x-apicenter-owner-tribe-id',
  'x-apicenter-project-id',
  'x-apicenter-consumer-service-id',
  'x-apicenter-source-service-id',
  'x-apicenter-environment',
]);

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function waitForSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
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

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeErrorDetails(item, depth + 1));
  }

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

export class ApiCenterTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly paymentApiKey?: string;
  private readonly accessTokenProvider?: AccessTokenProvider;
  private readonly serviceTokenProvider?: ServiceTokenProvider;

  constructor(options: ApiCenterTransportOptions) {
    if (!options.baseUrl.trim()) throw new TypeError('baseUrl is required');
    if (!options.auth && !options.paymentApiKey?.trim()) {
      throw new TypeError('Configure service auth or a paymentApiKey');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive number');
    }
    this.paymentApiKey = options.paymentApiKey?.trim() || undefined;

    if (options.auth && 'getAccessToken' in options.auth) {
      this.accessTokenProvider = options.auth;
    } else if (options.auth) {
      const credentials = options.auth as ServiceCredentials;
      const tokenRequest: TokenEndpointRequest = (path, body) =>
        this.request<IssuedServiceToken>({ path, method: 'POST', credential: 'none', body });
      this.serviceTokenProvider = new ServiceTokenProvider(credentials, tokenRequest);
    }
  }

  async request<T>(request: ApiRequest): Promise<T> {
    if (request.options?.signal?.aborted) {
      throw request.options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
    }
    const headers = new Headers({ Accept: 'application/json' });
    for (const [name, value] of Object.entries(request.options?.headers ?? {})) {
      if (protectedHeaders.has(name.toLowerCase())) {
        throw new TypeError(`The ${name} header is managed by the APICenter SDK`);
      }
      headers.set(name, value);
    }

    if (request.idempotencyKey !== undefined) {
      const key = request.idempotencyKey.trim();
      if (key.length < 16 || key.length > 255) {
        throw new TypeError('idempotencyKey must be between 16 and 255 characters');
      }
      headers.set('Idempotency-Key', key);
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error('APICenter request timed out')),
      this.timeoutMs,
    );
    const signal = request.options?.signal
      ? AbortSignal.any([request.options.signal, timeoutController.signal])
      : timeoutController.signal;
    let requestStarted = false;

    try {
      const token = await waitForSignal(
        this.resolveCredential(request.credential, signal),
        signal,
      );
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (request.body !== undefined) headers.set('Content-Type', 'application/json');

      requestStarted = true;
      const response = await this.fetchImpl(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        signal,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      return this.decodeResponse<T>(response, text);
    } catch (error) {
      if (request.options?.signal?.aborted) throw abortReason(request.options.signal);
      if (timeoutController.signal.aborted) {
        throw new ApiCenterError(`APICenter request timed out after ${this.timeoutMs}ms`, {
          status: 0,
          code: 'REQUEST_TIMEOUT',
          cause: error,
        });
      }
      if (error instanceof ApiCenterError) throw error;
      if (!requestStarted) throw error;
      throw new ApiCenterError('Could not reach APICenter', {
        status: 0,
        code: 'NETWORK_ERROR',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveCredential(
    credential: ApiCredential,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (credential === 'none') return undefined;
    if (credential === 'payment' && this.paymentApiKey) return this.paymentApiKey;
    if (this.accessTokenProvider) {
      const token = await this.accessTokenProvider.getAccessToken({ signal });
      if (typeof token !== 'string' || !token.trim()) {
        throw new TypeError('getAccessToken must return a non-empty access token');
      }
      return token;
    }
    if (this.serviceTokenProvider) return this.serviceTokenProvider.getAccessToken();
    throw new TypeError(
      credential === 'payment'
        ? 'Payments require paymentApiKey or service auth with payment scopes'
        : 'This operation requires service auth',
    );
  }

  private decodeResponse<T>(response: Response, text: string): T {
    if (!text.trim() && response.status === 204) return undefined as T;

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiCenterError(
        text.trim()
          ? `APICenter returned invalid JSON (${response.status})`
          : `APICenter returned an empty response (${response.status})`,
        {
          status: response.status,
          code: text.trim() ? 'INVALID_JSON' : 'EMPTY_RESPONSE',
          correlationId: this.responseCorrelationId(response),
        },
      );
    }

    const envelope = objectValue(payload);
    const apiError = objectValue(envelope?.error);
    const meta = objectValue(envelope?.meta);
    const correlationId =
      stringValue(meta?.correlationId) ?? this.responseCorrelationId(response);
    const isSuccessStatus = response.ok || response.status === 202;

    if (
      isSuccessStatus &&
      envelope?.success === true &&
      Object.prototype.hasOwnProperty.call(envelope, 'data')
    ) {
      return envelope.data as T;
    }

    const message = response.status >= 500
      ? `APICenter returned an error (${response.status})`
      : redactSensitiveText(
        stringValue(apiError?.message) ??
        stringValue(envelope?.message) ??
        `APICenter request failed (${response.status})`,
      );
    throw new ApiCenterError(message, {
      status: response.status,
      code: stringValue(apiError?.code) ?? stringValue(envelope?.code),
      details: response.status >= 500 ? undefined : sanitizeErrorDetails(apiError?.details),
      correlationId,
    });
  }

  private responseCorrelationId(response: Response): string | undefined {
    return (
      response.headers.get('x-apicenter-correlation-id') ??
      response.headers.get('x-correlation-id') ??
      undefined
    );
  }
}
