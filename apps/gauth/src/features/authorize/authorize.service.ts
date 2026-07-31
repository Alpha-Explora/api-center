import crypto from 'node:crypto';
import { createSignedOAuthState } from '../../shared/oauth-state.signer';
import { GoogleOAuthCredential } from '../../shared/credential-resolver';

const googleAuthBaseUrl = process.env.GOOGLE_AUTH_BASE_URL || 'https://accounts.google.com/o/oauth2/v2/auth';

function normalizeScopes(scopes: any): string[] {
  if (!Array.isArray(scopes)) {
    return ['openid', 'email'];
  }
  const unique = [...new Set(scopes.filter((scope) => typeof scope === 'string' && scope.trim()))];
  return unique.length > 0 ? unique : ['openid', 'email'];
}

export class AuthorizeService {
  execute(payload: any, credential: GoogleOAuthCredential) {
    const state = credential.tenantSlug
      ? createSignedOAuthState({
        tenantSlug: credential.tenantSlug,
        source: credential.source,
        redirectUri: credential.redirectUri,
        callerState: typeof payload.state === 'string' ? payload.state : undefined,
      })
      : payload.state || crypto.randomUUID().replace(/-/g, '');
    const scopes = normalizeScopes(payload.scopes);

    const params = new URLSearchParams({
      client_id: credential.clientId,
      redirect_uri: credential.redirectUri!,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      access_type: payload.accessType === 'offline' ? 'offline' : 'online',
      include_granted_scopes: payload.includeGrantedScopes === false ? 'false' : 'true',
      prompt: typeof payload.prompt === 'string' ? payload.prompt : 'consent',
    });

    if (typeof payload.loginHint === 'string' && payload.loginHint) {
      params.set('login_hint', payload.loginHint);
    }

    if (typeof payload.codeChallenge === 'string' && payload.codeChallenge) {
      params.set('code_challenge', payload.codeChallenge);
      params.set('code_challenge_method', payload.codeChallengeMethod === 'plain' ? 'plain' : 'S256');
    }

    const authorizationUrl = `${googleAuthBaseUrl}?${params.toString()}`;

    return {
      authorizationUrl,
      state,
      tenantSlug: credential.tenantSlug,
      credentialSource: credential.source,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }
}
