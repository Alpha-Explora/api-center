import type { GoogleAuthorizationUrlRequest, GoogleAuthorizationUrlResponse, GoogleLogoutRequest, GoogleLogoutResponse, GoogleOAuthTokenResponse, GoogleTokenExchangeRequest, GoogleTokenRefreshRequest } from '@apicenter/contracts';
import type { RequestOptions } from '../types';
import { ApiCenterTransport } from '../internal/transport';

export class GoogleAuthClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation googleAuth.getAuthorizationUrl POST /api/v1/shared/gauth/oauth/authorize */
  getAuthorizationUrl(input: GoogleAuthorizationUrlRequest, options?: RequestOptions): Promise<GoogleAuthorizationUrlResponse> {
    return this.transport.request({
      path: '/api/v1/shared/gauth/oauth/authorize', method: 'POST', credential: 'service', body: input, options,
    });
  }

  /** @sdk-operation googleAuth.exchangeCode POST /api/v1/shared/gauth/oauth/token */
  exchangeCode(input: GoogleTokenExchangeRequest, options?: RequestOptions): Promise<GoogleOAuthTokenResponse> {
    return this.transport.request({
      path: '/api/v1/shared/gauth/oauth/token', method: 'POST', credential: 'service', body: input, options,
    });
  }

  /** @sdk-operation googleAuth.refreshToken POST /api/v1/shared/gauth/oauth/token/refresh */
  refreshToken(input: GoogleTokenRefreshRequest, options?: RequestOptions): Promise<GoogleOAuthTokenResponse> {
    return this.transport.request({
      path: '/api/v1/shared/gauth/oauth/token/refresh', method: 'POST', credential: 'service', body: input, options,
    });
  }

  /** @sdk-operation googleAuth.logout POST /api/v1/shared/gauth/oauth/logout */
  logout(input: GoogleLogoutRequest, options?: RequestOptions): Promise<GoogleLogoutResponse> {
    return this.transport.request({
      path: '/api/v1/shared/gauth/oauth/logout', method: 'POST', credential: 'service', body: input, options,
    });
  }
}
