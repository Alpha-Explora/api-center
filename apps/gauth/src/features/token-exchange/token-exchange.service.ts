import { GoogleOAuthCredential } from '../../shared/credential-resolver';
import { verifySignedOAuthState } from '../../shared/oauth-state.signer';
import { callGoogleProvider } from '../../shared/google-provider';

const googleTokenUrl = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

export class TokenExchangeService {
  async execute(payload: any, credential: GoogleOAuthCredential) {
    const { code, codeVerifier } = payload;

    if (payload.tenantSlug) {
      let verifiedState = null;
      try {
        verifiedState = verifySignedOAuthState(payload.state);
      } catch {
        verifiedState = null;
      }

      if (
        !verifiedState ||
        verifiedState.tenantSlug !== payload.tenantSlug ||
        verifiedState.source !== credential.source ||
        verifiedState.redirectUri !== credential.redirectUri
      ) {
        throw { status: 400, code: 'INVALID_OAUTH_STATE', message: 'Tenant Google OAuth token exchange requires a valid signed state.' };
      }
    }

    if (!code || !credential.redirectUri) {
      throw { status: 400, code: 'INVALID_TOKEN_EXCHANGE_REQUEST', message: 'code and redirectUri are required.' };
    }

    const tokenPayload = new URLSearchParams({
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      code,
      redirect_uri: credential.redirectUri,
      grant_type: 'authorization_code',
    });

    if (typeof codeVerifier === 'string' && codeVerifier) {
      tokenPayload.set('code_verifier', codeVerifier);
    }

    const response = await callGoogleProvider('token_exchange', googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenPayload.toString(),
    });

    const body = await response.json();

    if (!response.ok) {
      throw {
        status: 502,
        code: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
        message: body.error_description || body.error || 'Google token exchange failed.',
        details: body,
      };
    }

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token || null,
      idToken: body.id_token,
      expiresIn: body.expires_in,
      tokenType: body.token_type,
      scope: body.scope,
    };
  }
}
