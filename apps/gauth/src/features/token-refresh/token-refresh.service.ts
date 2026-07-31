import { GoogleOAuthCredential } from '../../shared/credential-resolver';
import { callGoogleProvider } from '../../shared/google-provider';

const googleTokenUrl = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

export class TokenRefreshService {
  async execute(payload: any, credential: GoogleOAuthCredential) {
    const { refreshToken } = payload;

    if (!refreshToken) {
      throw { status: 400, code: 'INVALID_REFRESH_REQUEST', message: 'refreshToken is required.' };
    }

    const refreshPayload = new URLSearchParams({
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await callGoogleProvider('token_refresh', googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshPayload.toString(),
    });

    const body = await response.json();

    if (!response.ok) {
      throw {
        status: 502,
        code: 'GOOGLE_TOKEN_REFRESH_FAILED',
        message: body.error_description || body.error || 'Google token refresh failed.',
        details: body,
      };
    }

    return {
      accessToken: body.access_token,
      refreshToken,
      idToken: body.id_token,
      expiresIn: body.expires_in,
      tokenType: body.token_type,
      scope: body.scope,
    };
  }
}
