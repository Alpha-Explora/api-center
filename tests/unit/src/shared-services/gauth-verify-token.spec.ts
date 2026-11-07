import { VerifyTokenService, GoogleIdTokenVerifier } from '../../../../apps/gauth/src/features/verify-token/verify-token.service';
import { createVerifyTokenRouteHandler } from '../../../../apps/gauth/src/features/verify-token/verify-token.route-handler';
import { MemoryOAuthAppStore, OAuthAppRecord } from '../../../../apps/gauth/src/shared/oauth-app-store';
import { OAuth2Client } from 'google-auth-library';

const activeSharedApp: OAuthAppRecord = {
  projectId: 'serbizio',
  environment: 'test',
  redirectUris: ['https://serbizio.example/callback'],
  clientId: null,
  clientSecretRef: null,
  displayName: 'Serbizio',
  status: 'active',
};

function createVerifier(payload: Record<string, unknown>) {
  const verifyIdToken = jest.fn().mockResolvedValue({ getPayload: () => payload });
  return { verifyIdToken } as unknown as GoogleIdTokenVerifier & { verifyIdToken: jest.Mock };
}

describe('gauth Google ID token verification', () => {
  afterEach(() => jest.restoreAllMocks());

  it('verifies the signature and audience against the active project registration', async () => {
    const store = new MemoryOAuthAppStore();
    store.upsert({ ...activeSharedApp, clientId: 'serbizio-test-client.apps.googleusercontent.com' });
    const verifier = createVerifier({
      sub: 'google-subject-123',
      email: 'person@example.com',
      email_verified: true,
      name: 'Example Person',
      picture: 'https://example.com/person.png',
    });
    const service = new VerifyTokenService({ store, verifier, env: { GOOGLE_CLIENT_ID: 'shared-client' } });

    await expect(service.execute({ idToken: 'signed-google-id-token' }, { projectId: 'serbizio', environment: 'test' })).resolves.toEqual({
      valid: true,
      userId: 'google-subject-123',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Example Person',
      picture: 'https://example.com/person.png',
    });
    expect(verifier.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token',
      audience: 'serbizio-test-client.apps.googleusercontent.com',
    });
  });

  it('uses the configured APICenter client only for an active shared-client registration', async () => {
    const store = new MemoryOAuthAppStore();
    store.upsert(activeSharedApp);
    const verifier = createVerifier({ sub: 'shared-user' });
    const service = new VerifyTokenService({ store, verifier, env: { GOOGLE_CLIENT_ID: 'apicenter-shared-client' } });

    await service.execute({ idToken: 'signed-id-token' }, { projectId: 'serbizio', environment: 'test' });

    expect(verifier.verifyIdToken).toHaveBeenCalledWith({ idToken: 'signed-id-token', audience: 'apicenter-shared-client' });
  });

  it('calls google-auth-library verifyIdToken with the registered project audience by default', async () => {
    const store = new MemoryOAuthAppStore();
    store.upsert({ ...activeSharedApp, clientId: 'registered-project-client' });
    const verifyIdToken = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: 'verified-subject' }),
    } as never);
    const service = new VerifyTokenService({ store, env: {} });

    await expect(service.execute({ idToken: 'signed-token' }, { projectId: 'serbizio', environment: 'test' })).resolves.toMatchObject({
      valid: true,
      userId: 'verified-subject',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'signed-token', audience: 'registered-project-client' });
  });

  it('fails closed when neither the project nor shared client audience is configured', async () => {
    const store = new MemoryOAuthAppStore();
    store.upsert(activeSharedApp);
    const verifier = createVerifier({ sub: 'must-not-verify' });
    const service = new VerifyTokenService({ store, verifier, env: {} });

    await expect(service.execute({ idToken: 'token' }, { projectId: 'serbizio', environment: 'test' })).rejects.toMatchObject({
      status: 503,
      code: 'GOOGLE_CONFIG_ERROR',
    });
    expect(verifier.verifyIdToken).not.toHaveBeenCalled();
  });

  it('returns sanitized failures for missing tokens and registration-store errors', async () => {
    const verifier = createVerifier({ sub: 'must-not-verify' });
    const store = new MemoryOAuthAppStore();
    store.upsert(activeSharedApp);
    const service = new VerifyTokenService({ store, verifier, env: { GOOGLE_CLIENT_ID: 'shared-client' } });
    await expect(service.execute(null as never, { projectId: 'serbizio', environment: 'test' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });

    const brokenStore = { findByProjectAndEnvironment: jest.fn().mockRejectedValue(new Error('database password leaked')) };
    const brokenService = new VerifyTokenService({ store: brokenStore as never, verifier, env: { GOOGLE_CLIENT_ID: 'shared-client' } });
    await expect(brokenService.execute({ idToken: 'token' }, { projectId: 'serbizio', environment: 'test' })).rejects.toEqual({
      status: 503,
      code: 'OAUTH_APP_LOOKUP_FAILED',
      message: 'Google OAuth app registration could not be read.',
    });
    expect(verifier.verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects missing context and unregistered or inactive projects before verification', async () => {
    const store = new MemoryOAuthAppStore();
    store.upsert({ ...activeSharedApp, status: 'disabled' });
    const verifier = createVerifier({ sub: 'must-not-verify' });
    const service = new VerifyTokenService({ store, verifier, env: { GOOGLE_CLIENT_ID: 'shared-client' } });

    await expect(service.execute({ idToken: 'token' }, {})).rejects.toMatchObject({ code: 'INVALID_PROJECT_CONTEXT' });
    await expect(service.execute({ idToken: 'token' }, { projectId: 'missing', environment: 'test' })).rejects.toMatchObject({ code: 'OAUTH_APP_NOT_REGISTERED' });
    await expect(service.execute({ idToken: 'token' }, { projectId: 'serbizio', environment: 'test' })).rejects.toMatchObject({ code: 'OAUTH_APP_NOT_REGISTERED' });
    expect(verifier.verifyIdToken).not.toHaveBeenCalled();
  });

  it('fails closed when the verifier rejects a bad, expired, or wrong-audience token', async () => {
    const store = new MemoryOAuthAppStore();
    store.upsert(activeSharedApp);
    const verifier = { verifyIdToken: jest.fn().mockRejectedValue(new Error('invalid signature or audience')) };
    const service = new VerifyTokenService({ store, verifier, env: { GOOGLE_CLIENT_ID: 'shared-client' } });

    await expect(service.execute({ idToken: 'invalid' }, { projectId: 'serbizio', environment: 'test' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ID_TOKEN',
    });
  });

  it('uses only trusted gateway headers for the project context and ignores caller body fields', async () => {
    const execute = jest.fn().mockResolvedValue({ valid: true, userId: 'subject' });
    const handler = createVerifyTokenRouteHandler({ execute });
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = {
      body: { idToken: 'token', projectId: 'attacker-project', environment: 'live', audience: 'attacker-client' },
      header: (name: string) => ({
        'X-APICenter-Project-Id': 'serbizio',
        'X-APICenter-Environment': 'test',
      } as Record<string, string>)[name],
    } as never;

    await handler(req, { status, json } as never);

    expect(execute).toHaveBeenCalledWith(
      { idToken: 'token', projectId: 'attacker-project', environment: 'live', audience: 'attacker-client' },
      { projectId: 'serbizio', environment: 'test' },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: { valid: true, userId: 'subject' } }));
  });

  it('handles a missing body and hides unexpected route errors', async () => {
    const verifier = createVerifier({ sub: 'unused' });
    const store = new MemoryOAuthAppStore();
    store.upsert(activeSharedApp);
    const handler = createVerifyTokenRouteHandler(new VerifyTokenService({ store, verifier, env: { GOOGLE_CLIENT_ID: 'shared-client' } }));
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = { body: undefined, header: () => undefined } as never;

    await handler(req, { status, json } as never);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_REQUEST' }) }));

    const execute = jest.fn().mockRejectedValue(new Error('database password leaked'));
    const unexpectedHandler = createVerifyTokenRouteHandler({ execute });
    status.mockClear();
    json.mockClear();
    await unexpectedHandler({ body: { idToken: 'token' }, header: () => 'serbizio' } as never, { status, json } as never);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({
      code: 'GAUTH_VERIFICATION_FAILED',
      message: 'Google ID token verification could not be completed.',
    }) }));
    expect(json).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'database password leaked' }));
  });
});
