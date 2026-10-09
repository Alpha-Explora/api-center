import type { ClientSecretReader } from './client-secret-reader';
import { GauthEnvironment, OAuthAppStore, parseGauthEnvironment } from './oauth-app-store';

export interface GoogleOAuthCredential {
  source: 'shared' | 'project';
  projectId: string;
  environment: GauthEnvironment;
  displayName: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type ResolveCredentialResult =
  | { ok: true; credential: GoogleOAuthCredential }
  | { ok: false; status: number; code: string; message: string };

export interface CredentialRequest {
  projectId?: string | null;
  environment?: string | null;
  redirectUri?: string | null;
}

export interface CredentialDependencies {
  store: OAuthAppStore;
  secrets: ClientSecretReader;
  env?: Record<string, string | undefined>;
}

function failure(status: number, code: string, message: string): ResolveCredentialResult {
  return { ok: false, status, code, message };
}

/**
 * Picks the Google client for a calling project and environment. A registered row with its own client uses that
 * client, and a row without one uses APICenter's shared client. The redirect URI must be one the row lists;
 * when the caller omits it, the first listed URI is used.
 */
export async function resolveGoogleOAuthCredential(
  request: CredentialRequest,
  deps: CredentialDependencies,
): Promise<ResolveCredentialResult> {
  const env = deps.env ?? process.env;
  const environment = parseGauthEnvironment(request.environment);
  if (!request.projectId || !environment) {
    return failure(400, 'INVALID_PROJECT_CONTEXT', 'X-APICenter-Project-Id and X-APICenter-Environment (test or live) are required.');
  }

  const app = await deps.store.findByProjectAndEnvironment(request.projectId, environment);
  if (!app || app.status !== 'active') {
    return failure(403, 'OAUTH_APP_NOT_REGISTERED', `Project ${request.projectId} has no active Google OAuth app for ${environment}.`);
  }

  const requestedRedirectUri = request.redirectUri || null;
  if (requestedRedirectUri && !app.redirectUris.includes(requestedRedirectUri)) {
    return failure(400, 'REDIRECT_URI_NOT_REGISTERED', 'redirectUri is not registered for this project and environment.');
  }
  const redirectUri = requestedRedirectUri ?? app.redirectUris[0];

  if (app.clientId && app.clientSecretRef) {
    let clientSecret: string;
    try {
      clientSecret = await deps.secrets.read(app.clientSecretRef);
    } catch {
      return failure(503, 'OAUTH_CLIENT_SECRET_UNAVAILABLE', 'The Google client secret for this project could not be read.');
    }
    return {
      ok: true,
      credential: {
        source: 'project',
        projectId: app.projectId,
        environment,
        displayName: app.displayName,
        clientId: app.clientId,
        clientSecret,
        redirectUri,
      },
    };
  }

  const sharedClientId = env.GOOGLE_CLIENT_ID;
  const sharedClientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!sharedClientId || !sharedClientSecret) {
    return failure(500, 'GOOGLE_CONFIG_ERROR', 'Google OAuth credentials are not configured.');
  }
  return {
    ok: true,
    credential: {
      source: 'shared',
      projectId: app.projectId,
      environment,
      displayName: app.displayName,
      clientId: sharedClientId,
      clientSecret: sharedClientSecret,
      redirectUri,
    },
  };
}
