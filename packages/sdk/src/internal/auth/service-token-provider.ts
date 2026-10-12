import type { PaymentEnvironment } from '@alpha-explora/apicenter-contracts';
import { ApiCenterError } from '../errors';

export interface ServiceCredentials {
  serviceId: string;
  environment: PaymentEnvironment;
  secret: string;
}

export interface IssuedServiceToken {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

export type TokenEndpointRequest = (
  path: string,
  body: Record<string, string>,
) => Promise<IssuedServiceToken>;

interface CachedServiceToken extends IssuedServiceToken {
  expiresAt: number;
  refreshAt: number;
}

export class ServiceTokenProvider {
  private token?: CachedServiceToken;
  private pending?: Promise<string>;

  constructor(
    private readonly credentials: ServiceCredentials,
    private readonly request: TokenEndpointRequest,
    private readonly now: () => number = Date.now,
  ) {
    if (!credentials.serviceId.trim() || !credentials.secret.trim()) {
      throw new TypeError('serviceId and service secret are required');
    }
  }

  getAccessToken(): Promise<string> {
    if (this.token && this.now() < this.token.refreshAt) {
      return Promise.resolve(this.token.accessToken);
    }
    if (this.pending) return this.pending;

    this.pending = this.loadToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async loadToken(): Promise<string> {
    let issued: IssuedServiceToken;
    if (this.token?.refreshToken) {
      const previousToken = this.token;
      try {
        issued = await this.request('/api/v1/auth/token/refresh', {
          refreshToken: previousToken.refreshToken!,
        });
      } catch (error) {
        // A rotated refresh token may already be consumed. Never retry it on a
        // later request; a subsequent call can obtain a fresh token by secret.
        if (this.token === previousToken) this.token = undefined;
        throw error;
      }
    } else {
      issued = await this.request('/api/v1/auth/token', {
        serviceId: this.credentials.serviceId,
        environment: this.credentials.environment,
        secret: this.credentials.secret,
      });
    }

    if (
      typeof issued.accessToken !== 'string' ||
      !issued.accessToken.trim() ||
      !Number.isFinite(issued.expiresIn) ||
      issued.expiresIn <= 0
    ) {
      throw new ApiCenterError('APICenter returned an invalid service token response', {
        status: 502,
        code: 'INVALID_TOKEN_RESPONSE',
      });
    }

    const expiresAt = this.now() + issued.expiresIn * 1000;
    const refreshSkewMs = Math.min(60_000, issued.expiresIn * 100);
    this.token = {
      ...issued,
      expiresAt,
      refreshAt: expiresAt - refreshSkewMs,
    };
    return issued.accessToken;
  }
}
