import type {
  GoogleAuthorizationUrlRequest,
  GoogleAuthorizationUrlResponse,
  GoogleLogoutRequest,
  GoogleLogoutResponse,
  GoogleOAuthTokenResponse,
  GoogleTokenExchangeRequest,
  GoogleTokenRefreshRequest,
} from '@alpha-explora/apicenter-contracts';
import type { ApiCenterTransport } from '../internal/transport.js';
import type { RequestOptions } from '../types.js';

/** Google sign-in for your users, through the OAuth client registered for your project. */
export class GoogleAuthClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation auth.google.getAuthorizationUrl POST /api/v1/shared/gauth/oauth/authorize */
  getAuthorizationUrl(input: GoogleAuthorizationUrlRequest, options?: RequestOptions): Promise<GoogleAuthorizationUrlResponse> {
    return this.transport.request({ path: '/api/v1/shared/gauth/oauth/authorize', method: 'POST', body: input, options });
  }

  /** @sdk-operation auth.google.exchangeCode POST /api/v1/shared/gauth/oauth/token */
  exchangeCode(input: GoogleTokenExchangeRequest, options?: RequestOptions): Promise<GoogleOAuthTokenResponse> {
    return this.transport.request({ path: '/api/v1/shared/gauth/oauth/token', method: 'POST', body: input, options });
  }

  /** @sdk-operation auth.google.refreshToken POST /api/v1/shared/gauth/oauth/token/refresh */
  refreshToken(input: GoogleTokenRefreshRequest, options?: RequestOptions): Promise<GoogleOAuthTokenResponse> {
    return this.transport.request({ path: '/api/v1/shared/gauth/oauth/token/refresh', method: 'POST', body: input, options });
  }

  /** @sdk-operation auth.google.logout POST /api/v1/shared/gauth/oauth/logout */
  logout(input: GoogleLogoutRequest, options?: RequestOptions): Promise<GoogleLogoutResponse> {
    return this.transport.request({ path: '/api/v1/shared/gauth/oauth/logout', method: 'POST', body: input, options });
  }
}
