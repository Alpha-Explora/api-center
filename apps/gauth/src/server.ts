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
import { GoogleOAuthCredential, resolveGoogleOAuthCredential } from './shared/credential-resolver';
import { SecretManagerClientSecretReader } from './shared/client-secret-reader';
import { createOAuthAppStore } from './shared/oauth-app-store';
import { getStateSecret } from './shared/oauth-state.signer';
import { createOAuthAppAdminHandler } from './shared/oauth-app-admin';

// Throws at startup in production when GOOGLE_OAUTH_STATE_SECRET is missing, so the service never runs unsigned.
getStateSecret(process.env);

const port = Number(process.env.PORT || 4013);
const authorizeLimit = Number(process.env.GAUTH_AUTHORIZE_LIMIT_PER_SUBJECT || 20);
const authorizeWindowMs = Number(process.env.GAUTH_AUTHORIZE_LIMIT_WINDOW_MS || 60_000);
const rateLimitStore = createMemoryRateLimitStore();
const credentialDependencies = {
  store: createOAuthAppStore(process.env),
  secrets: new SecretManagerClientSecretReader(),
  env: process.env,
};
const oauthAppAdminHandler = createOAuthAppAdminHandler({
  store: credentialDependencies.store,
  expectedToken: process.env.GAUTH_ADMIN_TOKEN,
});

const { app } = createSharedServiceApp({
  serviceId: 'gauth-gateway',
  health: {
    status: 'ok',
    provider: 'google',
    architecture: 'enterprise-feature-sliced',
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  },
});

const authorizeService = new AuthorizeService();
const tokenExchangeService = new TokenExchangeService();
const tokenRefreshService = new TokenRefreshService();
const logoutService = new LogoutService();
const verifyTokenService = new VerifyTokenService();

app.all('/admin/oauth-apps/:projectId/:environment', oauthAppAdminHandler);

/** The gateway sets the project and environment headers and strips any the caller sends, so they can be trusted. */
async function resolveCredentialForRequest(req: Request, res: Response): Promise<GoogleOAuthCredential | null> {
  const redirectUri = typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : null;
  let resolved;
  try {
    resolved = await resolveGoogleOAuthCredential(
      {
        projectId: req.header('X-APICenter-Project-Id'),
        environment: req.header('X-APICenter-Environment'),
        redirectUri,
      },
      credentialDependencies,
    );
  } catch {
    fail(res, 503, 'OAUTH_APP_LOOKUP_FAILED', 'Google OAuth app registration could not be read.');
    return null;
  }

  if (!resolved.ok) {
    fail(res, resolved.status, resolved.code, resolved.message);
    return null;
  }
  return resolved.credential;
}

app.post('/oauth/authorize', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const credential = await resolveCredentialForRequest(req, res);

  if (!credential) {
    return;
  }

  const subject = payload.loginHint || payload.redirectUri || req.ip || 'anonymous';
  const limit = await rateLimitStore.consume(
    `gauth:authorize:${credential.projectId}:${credential.environment}:${String(subject).toLowerCase()}`,
    {
      limit: authorizeLimit,
      windowMs: authorizeWindowMs,
    },
  );
  if (!limit.allowed) {
    return fail(res, 429, 'RATE_LIMITED', 'Google authorization request limit exceeded.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  const result = authorizeService.execute(payload, credential);
  return ok(res, result);
});

app.post('/oauth/token', async (req: Request, res: Response) => {
  const credential = await resolveCredentialForRequest(req, res);

  if (!credential) {
    return;
  }

  try {
    const result = await tokenExchangeService.execute(req.body || {}, credential);
    return ok(res, result);
  } catch (err: any) {
    return fail(res, err.status || 502, err.code || 'GOOGLE_TOKEN_EXCHANGE_FAILED', err.message, err.details);
  }
});

app.post('/oauth/token/refresh', async (req: Request, res: Response) => {
  const credential = await resolveCredentialForRequest(req, res);

  if (!credential) {
    return;
  }

  try {
    const result = await tokenRefreshService.execute(req.body || {}, credential);
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
