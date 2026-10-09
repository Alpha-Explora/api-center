import { GoogleOAuthCredential } from '../../shared/credential-resolver';
import { verifySignedOAuthState } from '../../shared/oauth-state.signer';
import { callGoogleProvider } from '../../shared/google-provider';

const googleTokenUrl = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

function assertStateIssuedForCredential(state: unknown, credential: GoogleOAuthCredential): void {
  let verified: any = null;
  try {
    verified = verifySignedOAuthState(typeof state === 'string' ? state : undefined);
  } catch {
    verified = null;
  }

  const matches =
    verified !== null &&
    verified.projectId === credential.projectId &&
    verified.environment === credential.environment &&
    verified.redirectUri === credential.redirectUri;
  if (!matches) {
    throw {
      status: 400,
      code: 'INVALID_OAUTH_STATE',
      message: 'state must come from an authorization request for this project, environment, and redirect URI.',
    };
  }
}

export class TokenExchangeService {
  async execute(payload: any, credential: GoogleOAuthCredential) {
    const { code, codeVerifier } = payload;

    assertStateIssuedForCredential(payload.state, credential);

    if (!code) {
      throw { status: 400, code: 'INVALID_TOKEN_EXCHANGE_REQUEST', message: 'code is required.' };
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
