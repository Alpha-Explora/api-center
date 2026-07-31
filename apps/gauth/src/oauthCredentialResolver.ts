const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface GoogleOAuthCredential {
  source: 'shared' | 'tenant' | 'shared-fallback';
  tenantSlug: string | null;
  displayName: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  authProjectId: string | null;
}

export type ResolveCredentialResult =
  | { ok: true; credential: GoogleOAuthCredential }
  | { ok: false; status: number; code: string; message: string };

export function parseTenantClients(rawJson?: string): Record<string, any> {
  if (!rawJson) {
    return {};
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('GOOGLE_OAUTH_TENANT_CLIENTS_JSON must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GOOGLE_OAUTH_TENANT_CLIENTS_JSON must be a JSON object keyed by tenant slug.');
  }

  return parsed;
}

export function normalizeTenantSlug(value?: string | null): string | null {
  if (typeof value !== 'string' || !TENANT_SLUG_PATTERN.test(value)) {
    return null;
  }

  return value;
}

function buildSharedCredential(env: Record<string, string | undefined>): GoogleOAuthCredential | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return null;
  }

  return {
    source: 'shared',
    tenantSlug: null,
    displayName: 'APICenter',
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI || null,
    authProjectId: null,
  };
}

export function resolveGoogleOAuthCredential({
  env = process.env,
  tenantSlug,
  redirectUri,
}: {
  env?: Record<string, string | undefined>;
  tenantSlug?: string | null;
  redirectUri?: string | null;
}): ResolveCredentialResult {
  const sharedCredential = buildSharedCredential(env);
  const normalizedTenantSlug = normalizeTenantSlug(tenantSlug);

  if (tenantSlug && !normalizedTenantSlug) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_TENANT_SLUG',
      message: 'tenantSlug must be a safe lowercase slug.',
    };
  }

  if (!normalizedTenantSlug) {
    if (!sharedCredential) {
      return {
        ok: false,
        status: 500,
        code: 'GOOGLE_CONFIG_ERROR',
        message: 'Google OAuth credentials are not configured.',
      };
    }

    return {
      ok: true,
      credential: {
        ...sharedCredential,
        redirectUri: redirectUri || sharedCredential.redirectUri,
      },
    };
  }

  const tenantClients = parseTenantClients(env.GOOGLE_OAUTH_TENANT_CLIENTS_JSON);
  const tenant = tenantClients[normalizedTenantSlug];

  if (!tenant) {
    return {
      ok: false,
      status: 404,
      code: 'TENANT_GOOGLE_OAUTH_NOT_FOUND',
      message: `Google OAuth is not configured for tenant '${normalizedTenantSlug}'.`,
    };
  }

  if (tenant.status !== 'active') {
    if (tenant.allowSharedOauthFallback && sharedCredential) {
      return {
        ok: true,
        credential: {
          ...sharedCredential,
          source: 'shared-fallback',
          tenantSlug: normalizedTenantSlug,
          displayName: tenant.displayName || sharedCredential.displayName,
          redirectUri: redirectUri || tenant.redirectUri || sharedCredential.redirectUri,
          authProjectId: tenant.authProjectId || null,
        },
      };
    }

    return {
      ok: false,
      status: 409,
      code: 'TENANT_GOOGLE_OAUTH_NOT_ACTIVE',
      message: `Google OAuth for tenant '${normalizedTenantSlug}' is not active.`,
    };
  }

  if (!tenant.clientId || !tenant.clientSecret || !tenant.redirectUri) {
    return {
      ok: false,
      status: 409,
      code: 'TENANT_GOOGLE_OAUTH_INCOMPLETE',
      message: `Google OAuth for tenant '${normalizedTenantSlug}' is active but missing client credentials or redirect URI.`,
    };
  }

  if (redirectUri && redirectUri !== tenant.redirectUri) {
    return {
      ok: false,
      status: 400,
      code: 'TENANT_GOOGLE_REDIRECT_URI_MISMATCH',
      message: `redirectUri must match the configured Google OAuth redirect URI for tenant '${normalizedTenantSlug}'.`,
    };
  }

  return {
    ok: true,
    credential: {
      source: 'tenant',
      tenantSlug: normalizedTenantSlug,
      displayName: tenant.displayName || normalizedTenantSlug,
      clientId: tenant.clientId,
      clientSecret: tenant.clientSecret,
      redirectUri: tenant.redirectUri,
      authProjectId: tenant.authProjectId || null,
    },
  };
}
