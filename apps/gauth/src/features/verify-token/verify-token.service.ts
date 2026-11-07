import type { GauthVerifyTokenRequest, GauthVerifyTokenResponse } from '@alpha-explora/apicenter-contracts';
import { OAuth2Client } from 'google-auth-library';
import { OAuthAppStore, parseGauthEnvironment } from '../../shared/oauth-app-store';

export interface VerifyTokenContext {
  projectId?: string | null;
  environment?: string | null;
}

export interface GoogleIdTokenVerifier {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<{
    getPayload(): GoogleIdTokenPayload | undefined;
  }>;
}

type GoogleIdTokenPayload = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
};

type VerifyTokenDependencies = {
  store: OAuthAppStore;
  env?: Record<string, string | undefined>;
  verifier?: GoogleIdTokenVerifier;
};

export class VerifyTokenService {
  private readonly store: OAuthAppStore;
  private readonly env: Record<string, string | undefined>;
  private readonly verifier: GoogleIdTokenVerifier;

  constructor(deps: VerifyTokenDependencies) {
    this.store = deps.store;
    this.env = deps.env ?? process.env;
    this.verifier = deps.verifier ?? new OAuth2Client();
  }

  async execute(input: GauthVerifyTokenRequest, context: VerifyTokenContext): Promise<GauthVerifyTokenResponse> {
    if (!input || typeof input !== 'object' || typeof input.idToken !== 'string' || !input.idToken.trim()) {
      throw { status: 400, code: 'INVALID_REQUEST', message: 'idToken is required.' };
    }

    const environment = parseGauthEnvironment(context.environment);
    if (!context.projectId || !environment) {
      throw { status: 400, code: 'INVALID_PROJECT_CONTEXT', message: 'Trusted APICenter project and environment context is required.' };
    }

    let app;
    try {
      app = await this.store.findByProjectAndEnvironment(context.projectId, environment);
    } catch {
      throw { status: 503, code: 'OAUTH_APP_LOOKUP_FAILED', message: 'Google OAuth app registration could not be read.' };
    }
    if (!app || app.status !== 'active') {
      throw { status: 403, code: 'OAUTH_APP_NOT_REGISTERED', message: `Project ${context.projectId} has no active Google OAuth app for ${environment}.` };
    }

    // A registered project's own client ID takes precedence. Shared-client rows use the
    // configured platform client; that is an intentional shared trust boundary.
    const audience = app.clientId || this.env.GOOGLE_CLIENT_ID;
    if (!audience) {
      throw { status: 503, code: 'GOOGLE_CONFIG_ERROR', message: 'No Google client audience is configured for this project and environment.' };
    }

    let payload: GoogleIdTokenPayload | undefined;
    try {
      const ticket = await this.verifier.verifyIdToken({ idToken: input.idToken, audience });
      payload = ticket.getPayload();
    } catch {
      throw { status: 401, code: 'INVALID_ID_TOKEN', message: 'Google ID token is invalid, expired, or has the wrong audience.' };
    }
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
      throw { status: 401, code: 'INVALID_ID_TOKEN', message: 'Google ID token has no valid subject.' };
    }

    return {
      valid: true,
      userId: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.email_verified === 'boolean' ? { emailVerified: payload.email_verified } : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
      ...(typeof payload.picture === 'string' ? { picture: payload.picture } : {}),
    };
  }
}
