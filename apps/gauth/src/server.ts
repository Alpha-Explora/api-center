import path from 'node:path';
import { Request, Response } from 'express';
import {
  createMemoryRateLimitStore,
  createSharedServiceApp,
  fail,
  ok,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { AuthorizeService } from './features/authorize/authorize.service';
import { TokenExchangeService } from './features/token-exchange/token-exchange.service';
import { TokenRefreshService } from './features/token-refresh/token-refresh.service';
import { LogoutService } from './features/logout/logout.service';
import { VerifyTokenService } from './features/verify-token/verify-token.service';
import { resolveGoogleOAuthCredential, GoogleOAuthCredential } from './shared/credential-resolver';

const port = Number(process.env.PORT || 4013);
const defaultRedirectUri = process.env.GOOGLE_REDIRECT_URI;
const authorizeLimit = Number(process.env.GAUTH_AUTHORIZE_LIMIT_PER_SUBJECT || 20);
const authorizeWindowMs = Number(process.env.GAUTH_AUTHORIZE_LIMIT_WINDOW_MS || 60_000);
const rateLimitStore = createMemoryRateLimitStore();

const { app } = createSharedServiceApp({
  serviceId: 'gauth-gateway',
  health: {
    status: 'ok',
    provider: 'google',
    architecture: 'enterprise-feature-sliced',
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    redirectUriConfigured: Boolean(defaultRedirectUri),
    tenantCredentialsConfigured: Boolean(process.env.GOOGLE_OAUTH_TENANT_CLIENTS_JSON),
  },
});

const authorizeService = new AuthorizeService();
const tokenExchangeService = new TokenExchangeService();
const tokenRefreshService = new TokenRefreshService();
const logoutService = new LogoutService();
const verifyTokenService = new VerifyTokenService();

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

app.post('/oauth/authorize', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const credential = resolveCredentialForRequest(res, payload);

  if (!credential) {
    return;
  }

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

  const result = authorizeService.execute(payload, credential);
  return ok(res, result);
});

app.post('/oauth/token', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const credential = resolveCredentialForRequest(res, payload);

  if (!credential) {
    return;
  }

  try {
    const result = await tokenExchangeService.execute(payload, credential);
    return ok(res, result);
  } catch (err: any) {
    return fail(res, err.status || 502, err.code || 'GOOGLE_TOKEN_EXCHANGE_FAILED', err.message, err.details);
  }
});

app.post('/oauth/token/refresh', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const credential = resolveCredentialForRequest(res, payload, { requireRedirectUri: false });

  if (!credential) {
    return;
  }

  try {
    const result = await tokenRefreshService.execute(payload, credential);
    return ok(res, result);
  } catch (err: any) {
    return fail(res, err.status || 502, err.code || 'GOOGLE_TOKEN_REFRESH_FAILED', err.message, err.details);
  }
});

app.post('/oauth/logout', async (req: Request, res: Response) => {
  try {
    const result = await logoutService.execute(req.body || {});
    return ok(res, result);
  } catch (err: any) {
    return fail(res, err.status || 502, err.code || 'GOOGLE_LOGOUT_FAILED', err.message);
  }
});

app.post('/verify-token', async (req: Request, res: Response) => {
  try {
    const result = verifyTokenService.execute(req.body || {});
    return ok(res, result);
  } catch (err: any) {
    return fail(res, err.status || 400, err.code || 'INVALID_REQUEST', err.message);
  }
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
