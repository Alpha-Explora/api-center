import crypto from 'node:crypto';
import path from 'node:path';
import { Request, Response } from 'express';
import {
  createCircuitBreaker,
  createMemoryRateLimitStore,
  createSharedServiceApp,
  fail,
  ok,
  recordProviderMetric,
  registerWithGateway as registerSharedServiceWithGateway,
  withProviderTimeout,
} from '@apicenter/runtime';
import type { GauthVerifyTokenRequest, GauthVerifyTokenResponse } from '@apicenter/contracts';
import {
  resolveGoogleOAuthCredential,
  GoogleOAuthCredential,
} from './oauthCredentialResolver';
import {
  createSignedOAuthState,
  verifySignedOAuthState,
} from './oauthState';

const port = Number(process.env.PORT || 4013);

const googleAuthBaseUrl = process.env.GOOGLE_AUTH_BASE_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const googleTokenUrl = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const googleRevokeUrl = process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';

const defaultRedirectUri = process.env.GOOGLE_REDIRECT_URI;
const providerTimeoutMs = Number(process.env.GAUTH_PROVIDER_TIMEOUT_MS || 2000);
const authorizeLimit = Number(process.env.GAUTH_AUTHORIZE_LIMIT_PER_SUBJECT || 20);
const authorizeWindowMs = Number(process.env.GAUTH_AUTHORIZE_LIMIT_WINDOW_MS || 60_000);
const rateLimitStore = createMemoryRateLimitStore();
const googleAuthCircuit = createCircuitBreaker({
  provider: 'google_oauth',
  failureThreshold: Number(process.env.GAUTH_PROVIDER_FAILURE_THRESHOLD || 5),
  resetAfterMs: Number(process.env.GAUTH_PROVIDER_CIRCUIT_RESET_MS || 30_000),
});
const { app } = createSharedServiceApp({
  serviceId: 'gauth-gateway',
  health: {
    status: 'ok',
    provider: 'google',
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    redirectUriConfigured: Boolean(defaultRedirectUri),
    tenantCredentialsConfigured: Boolean(process.env.GOOGLE_OAUTH_TENANT_CLIENTS_JSON),
  },
});

function resolveCredentialForRequest(res: Response, payload: any, options: { requireRedirectUri?: boolean } = {}): GoogleOAuthCredential | null {
  const { requireRedirectUri = true } = options;
  let resolved;
  try {
    resolved = resolveGoogleOAuthCredential({
      tenantSlug: payload.tenantSlug,
      redirectUri: payload.redirectUri,
    });
  } catch (error: any) {
    fail(res, 500, 'GOOGLE_CONFIG_ERROR', error?.message || 'Google OAuth configuration is invalid.');
    return null;
  }

  if (!resolved.ok) {
    fail(res, resolved.status, resolved.code, resolved.message);
    return null;
  }

  if (requireRedirectUri && !resolved.credential.redirectUri) {
    fail(
      res,
      400,
      'MISSING_REDIRECT_URI',
      'redirectUri is required in payload or Google OAuth tenant/default configuration.',
    );
    return null;
  }

  return resolved.credential;
}

function normalizeScopes(scopes: any): string[] {
  if (!Array.isArray(scopes)) {
    return ['openid', 'email'];
  }

  const unique = [...new Set(scopes.filter((scope) => typeof scope === 'string' && scope.trim()))];
  return unique.length > 0 ? unique : ['openid', 'email'];
}

async function callGoogleProvider(operation: string, url: string, options: any): Promise<any> {
  const startedAt = Date.now();
  try {
    const response = await googleAuthCircuit.exec(() => withProviderTimeout(
      fetch(url, options),
      {
        timeoutMs: providerTimeoutMs,
        provider: 'google_oauth',
        operation,
      },
    ));
    recordProviderMetric({
      serviceId: 'gauth',
      provider: 'google_oauth',
      operation,
      status: response.ok ? 'success' : 'error',
      latencyMs: Date.now() - startedAt,
    });
    return response;
  } catch (error: any) {
    recordProviderMetric({
      serviceId: 'gauth',
      provider: 'google_oauth',
      operation,
      status: 'error',
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
}

app.post('/oauth/authorize', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const credential = resolveCredentialForRequest(res, payload);

  if (!credential) {
    return;
  }

  const state = credential.tenantSlug
    ? createSignedOAuthState({
      tenantSlug: credential.tenantSlug,
      source: credential.source,
      redirectUri: credential.redirectUri,
      callerState: typeof payload.state === 'string' ? payload.state : undefined,
    })
    : payload.state || crypto.randomUUID().replace(/-/g, '');
  const scopes = normalizeScopes(payload.scopes);
  const subject = payload.loginHint || payload.redirectUri || req.ip || 'anonymous';
  const limit = await rateLimitStore.consume(`gauth:authorize:${String(subject).toLowerCase()}`, {
    limit: authorizeLimit,
    windowMs: authorizeWindowMs,
  });
  if (!limit.allowed) {
    return fail(res, 429, 'RATE_LIMITED', 'Google authorization request limit exceeded.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

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

  return ok(res, {
      authorizationUrl,
      state,
      tenantSlug: credential.tenantSlug,
      credentialSource: credential.source,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
});

app.post('/oauth/token', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const { code, codeVerifier } = payload;
  const credential = resolveCredentialForRequest(res, payload);

  if (!credential) {
    return;
  }

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
      return fail(res, 400, 'INVALID_OAUTH_STATE', 'Tenant Google OAuth token exchange requires a valid signed state.');
    }
  }

  if (!code || !credential.redirectUri) {
    return fail(res, 400, 'INVALID_TOKEN_EXCHANGE_REQUEST', 'code and redirectUri are required.');
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

  try {
    const response = await callGoogleProvider('token_exchange', googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenPayload.toString(),
    });

    const body = await response.json();

    if (!response.ok) {
      return fail(
        res,
        502,
        'GOOGLE_TOKEN_EXCHANGE_FAILED',
        body.error_description || body.error || 'Google token exchange failed.',
        body,
      );
    }

    return ok(res, {
        accessToken: body.access_token,
        refreshToken: body.refresh_token || null,
        idToken: body.id_token,
        expiresIn: body.expires_in,
        tokenType: body.token_type,
        scope: body.scope,
    });
  } catch (error: any) {
    return fail(res, 502, 'GOOGLE_TOKEN_EXCHANGE_FAILED', error?.message || 'Google token exchange failed.');
  }
});

app.post('/oauth/token/refresh', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const credential = resolveCredentialForRequest(res, payload, { requireRedirectUri: false });

  if (!credential) {
    return;
  }

  const { refreshToken } = payload;

  if (!refreshToken) {
    return fail(res, 400, 'INVALID_REFRESH_REQUEST', 'refreshToken is required.');
  }

  const refreshPayload = new URLSearchParams({
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  try {
    const response = await callGoogleProvider('token_refresh', googleTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshPayload.toString(),
    });

    const body = await response.json();

    if (!response.ok) {
      return fail(
        res,
        502,
        'GOOGLE_TOKEN_REFRESH_FAILED',
        body.error_description || body.error || 'Google token refresh failed.',
        body,
      );
    }

    return ok(res, {
        accessToken: body.access_token,
        refreshToken,
        idToken: body.id_token,
        expiresIn: body.expires_in,
        tokenType: body.token_type,
        scope: body.scope,
    });
  } catch (error: any) {
    return fail(res, 502, 'GOOGLE_TOKEN_REFRESH_FAILED', error?.message || 'Google token refresh failed.');
  }
});

app.post('/oauth/logout', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const token = payload.token || payload.refreshToken || payload.idTokenHint;

  if (!token) {
    return fail(res, 400, 'INVALID_LOGOUT_REQUEST', 'token, refreshToken, or idTokenHint is required.');
  }

  try {
    const response = await callGoogleProvider('logout', `${googleRevokeUrl}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.ok) {
      return fail(res, 502, 'GOOGLE_LOGOUT_FAILED', 'Google token revocation failed.');
    }

    return ok(res, {
        success: true,
    });
  } catch (error: any) {
    return fail(res, 502, 'GOOGLE_LOGOUT_FAILED', error?.message || 'Google token revocation failed.');
  }
});

app.post('/verify-token', async (req: Request, res: Response) => {
  const { idToken } = (req.body || {}) as GauthVerifyTokenRequest;
  if (!idToken) {
    return fail(res, 400, 'INVALID_REQUEST', 'idToken is required.');
  }

  const response: GauthVerifyTokenResponse = {
    valid: true,
    userId: 'google_user_mock_123',
    email: 'dev@alphaexplora.com',
    emailVerified: true,
    name: 'Developer Account',
  };

  return ok(res, response);
});

export async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../service-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'gauth',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[gauth-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

export { app };
