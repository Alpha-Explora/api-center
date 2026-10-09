import { TokenExchangeService } from '../../../../apps/gauth/src/features/token-exchange/token-exchange.service';
import { GoogleOAuthCredential } from '../../../../apps/gauth/src/shared/credential-resolver';
import { createOAuthAppStore, MemoryOAuthAppStore } from '../../../../apps/gauth/src/shared/oauth-app-store';
import { PostgresOAuthAppStore } from '../../../../apps/gauth/src/shared/postgres-oauth-app-store';
import {
  createSignedOAuthState,
  getStateSecret,
  verifySignedOAuthState,
} from '../../../../apps/gauth/src/shared/oauth-state.signer';

const redirectUri = 'https://alphaci.com/callback';
const alphaciLive: GoogleOAuthCredential = {
  source: 'project',
  projectId: 'alphaci',
  environment: 'live',
  displayName: 'AlphaCI',
  clientId: 'alphaci-client-id',
  clientSecret: 'alphaci-client-secret',
  redirectUri,
};

describe('gauth OAuth state and token exchange', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test', GOOGLE_OAUTH_STATE_SECRET: 'state-secret-for-tests-0123456789' };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('rejects a state issued for another project without calling Google', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const state = createSignedOAuthState({ projectId: 'other-project', environment: 'live', redirectUri });
    await expect(new TokenExchangeService().execute({ code: 'auth-code', state }, alphaciLive)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_OAUTH_STATE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a state issued for the same project in another environment', async () => {
    const state = createSignedOAuthState({ projectId: 'alphaci', environment: 'test', redirectUri });
    await expect(new TokenExchangeService().execute({ code: 'auth-code', state }, alphaciLive)).rejects.toMatchObject({
      code: 'INVALID_OAUTH_STATE',
    });
  });

  it('rejects a state issued for a different redirect URI', async () => {
    const state = createSignedOAuthState({
      projectId: 'alphaci',
      environment: 'live',
      redirectUri: 'https://staging.alphaci.com/callback',
    });
    await expect(new TokenExchangeService().execute({ code: 'auth-code', state }, alphaciLive)).rejects.toMatchObject({
      code: 'INVALID_OAUTH_STATE',
    });
  });

  it('rejects a request with no state and a state whose contents were changed', async () => {
    const service = new TokenExchangeService();
    await expect(service.execute({ code: 'auth-code' }, alphaciLive)).rejects.toMatchObject({ code: 'INVALID_OAUTH_STATE' });

    const state = createSignedOAuthState({ projectId: 'alphaci', environment: 'live', redirectUri });
    const tampered = (state[0] === 'a' ? 'b' : 'a') + state.slice(1);
    await expect(service.execute({ code: 'auth-code', state: tampered }, alphaciLive)).rejects.toMatchObject({
      code: 'INVALID_OAUTH_STATE',
    });
  });

  it('exchanges the code with the client of the project named in the state', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'access-token', id_token: 'id-token', expires_in: 3599, token_type: 'Bearer', scope: 'openid email' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const state = createSignedOAuthState({ projectId: 'alphaci', environment: 'live', redirectUri });

    const tokens = await new TokenExchangeService().execute({ code: 'auth-code', state }, alphaciLive);

    expect(tokens).toMatchObject({ accessToken: 'access-token', refreshToken: null });
    const sent = new URLSearchParams(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sent.get('client_id')).toBe('alphaci-client-id');
    expect(sent.get('client_secret')).toBe('alphaci-client-secret');
    expect(sent.get('redirect_uri')).toBe(redirectUri);
  });

  it('signs state with one secret and rejects it under another', () => {
    const state = createSignedOAuthState(
      { projectId: 'alphaci', environment: 'live', redirectUri },
      { GOOGLE_OAUTH_STATE_SECRET: 'secret-one-0123456789012345' },
    );
    expect(verifySignedOAuthState(state, { GOOGLE_OAUTH_STATE_SECRET: 'secret-one-0123456789012345' })).toMatchObject({
      projectId: 'alphaci',
      environment: 'live',
      redirectUri,
    });
    expect(verifySignedOAuthState(state, { GOOGLE_OAUTH_STATE_SECRET: 'secret-two-0123456789012345' })).toBeNull();
  });

  it('refuses to sign state in production without GOOGLE_OAUTH_STATE_SECRET', () => {
    expect(() => getStateSecret({ NODE_ENV: 'production' })).toThrow('GOOGLE_OAUTH_STATE_SECRET is required in production.');
    expect(() => createSignedOAuthState({ projectId: 'alphaci' }, { NODE_ENV: 'production' })).toThrow(
      'GOOGLE_OAUTH_STATE_SECRET is required in production.',
    );
  });

  it('does not start the gauth service in production without GOOGLE_OAUTH_STATE_SECRET', () => {
    process.env = { ...originalEnv, NODE_ENV: 'production' };
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    jest.isolateModules(() => {
      expect(() => require('../../../../apps/gauth/src/server')).toThrow(
        'GOOGLE_OAUTH_STATE_SECRET is required in production.',
      );
    });
  }, 60000);

  it('chooses the app store from the environment', async () => {
    expect(createOAuthAppStore({ NODE_ENV: 'test' })).toBeInstanceOf(MemoryOAuthAppStore);
    expect(() => createOAuthAppStore({ NODE_ENV: 'production' })).toThrow(
      'GAUTH_DATABASE_URL or DATABASE_URL is required in production.',
    );
    const postgres = createOAuthAppStore({
      NODE_ENV: 'test',
      GAUTH_DATABASE_URL: 'postgres://gauth:secret@127.0.0.1:1/apicenter',
      DATABASE_URL: 'postgres://other@127.0.0.1:1/other',
    });
    expect(postgres).toBeInstanceOf(PostgresOAuthAppStore);
    await (postgres as PostgresOAuthAppStore).close();
  });
});
