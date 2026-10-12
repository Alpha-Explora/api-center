import { ApiCenterError } from './errors';
import { ServiceTokenProvider, type IssuedServiceToken, type ServiceCredentials, type TokenEndpointRequest } from './auth/service-token-provider';
import type { ApiCenterAuth, RequestOptions } from '../types';

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

export class ApiCenterTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly paymentApiKey?: string;
  private readonly accessTokenProvider?: () => Promise<string>;
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
      this.accessTokenProvider = options.auth.getAccessToken;
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

    const token = await this.resolveCredential(request.credential);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (request.body !== undefined) headers.set('Content-Type', 'application/json');

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error('APICenter request timed out')),
      this.timeoutMs,
    );
    const signal = request.options?.signal
      ? AbortSignal.any([request.options.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        signal,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const text = await response.text();
      return this.decodeResponse<T>(response, text);
    } catch (error) {
      if (request.options?.signal?.aborted) throw error;
      if (timeoutController.signal.aborted) {
        throw new ApiCenterError(`APICenter request timed out after ${this.timeoutMs}ms`, {
          status: 0,
          code: 'REQUEST_TIMEOUT',
          cause: error,
        });
      }
      if (error instanceof ApiCenterError) throw error;
      throw new ApiCenterError('Could not reach APICenter', {
        status: 0,
        code: 'NETWORK_ERROR',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveCredential(credential: ApiCredential): Promise<string | undefined> {
    if (credential === 'none') return undefined;
    if (credential === 'payment' && this.paymentApiKey) return this.paymentApiKey;
    if (this.accessTokenProvider) {
      const token = await this.accessTokenProvider();
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

    const message =
      stringValue(apiError?.message) ??
      stringValue(envelope?.message) ??
      `APICenter request failed (${response.status})`;
    throw new ApiCenterError(message, {
      status: response.status,
      code: stringValue(apiError?.code) ?? stringValue(envelope?.code),
      details: apiError?.details,
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
