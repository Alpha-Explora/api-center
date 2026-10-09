import {
  CredentialDependencies,
  resolveGoogleOAuthCredential,
} from '../../../../apps/gauth/src/shared/credential-resolver';
import {
  ClientSecretReader,
  SecretManagerClientSecretReader,
  SecretVersionAccessor,
} from '../../../../apps/gauth/src/shared/client-secret-reader';
import { MemoryOAuthAppStore, OAuthAppRecord } from '../../../../apps/gauth/src/shared/oauth-app-store';

const sharedEnv = { GOOGLE_CLIENT_ID: 'shared-client-id', GOOGLE_CLIENT_SECRET: 'shared-client-secret' };
const ownSecretRef = 'projects/apicenter-prod/secrets/alphaci-google-client/versions/3';
const liveRequest = { projectId: 'alphaci', environment: 'live', redirectUri: null };

function registration(overrides: Partial<OAuthAppRecord> = {}): OAuthAppRecord {
  return {
    projectId: 'alphaci',
    environment: 'live',
    redirectUris: ['https://alphaci.com/callback', 'https://staging.alphaci.com/callback'],
    clientId: null,
    clientSecretRef: null,
    displayName: 'AlphaCI',
    status: 'active',
    ...overrides,
  };
}

function dependencies(records: OAuthAppRecord[], secrets: Record<string, string> = {}) {
  const store = new MemoryOAuthAppStore();
  for (const record of records) {
    store.upsert(record);
  }
  const reads: string[] = [];
  const reader: ClientSecretReader = {
    async read(ref) {
      reads.push(ref);
      if (!(ref in secrets)) {
        throw new Error(`Secret ${ref} is not readable.`);
      }
      return secrets[ref];
    },
  };
  const deps: CredentialDependencies = { store, secrets: reader, env: sharedEnv };
  return { deps, reads };
}

describe('gauth credential resolution', () => {
  it('rejects a project with no registration and reads no client secret', async () => {
    const { deps, reads } = dependencies([]);
    const result = await resolveGoogleOAuthCredential(liveRequest, deps);
    expect(result).toMatchObject({ ok: false, status: 403, code: 'OAUTH_APP_NOT_REGISTERED' });
    expect(reads).toEqual([]);
  });

  it('rejects a registration that is disabled', async () => {
    const { deps } = dependencies([registration({ status: 'disabled' })]);
    const result = await resolveGoogleOAuthCredential(liveRequest, deps);
    expect(result).toMatchObject({ ok: false, status: 403, code: 'OAUTH_APP_NOT_REGISTERED' });
  });

  it('keeps registrations separate per environment', async () => {
    const { deps } = dependencies([registration({ environment: 'test' })]);
    const result = await resolveGoogleOAuthCredential(liveRequest, deps);
    expect(result).toMatchObject({ ok: false, code: 'OAUTH_APP_NOT_REGISTERED' });
  });

  it('uses the project client and reads its secret from Secret Manager', async () => {
    const { deps, reads } = dependencies(
      [registration({ clientId: 'alphaci-client-id', clientSecretRef: ownSecretRef })],
      { [ownSecretRef]: 'alphaci-client-secret' },
    );
    const result = await resolveGoogleOAuthCredential(liveRequest, deps);
    expect(result).toEqual({
      ok: true,
      credential: {
        source: 'project',
        projectId: 'alphaci',
        environment: 'live',
        displayName: 'AlphaCI',
        clientId: 'alphaci-client-id',
        clientSecret: 'alphaci-client-secret',
        redirectUri: 'https://alphaci.com/callback',
      },
    });
    expect(reads).toEqual([ownSecretRef]);
  });

  it('uses the shared client when the registration has none', async () => {
    const { deps, reads } = dependencies([registration()]);
    const result = await resolveGoogleOAuthCredential(liveRequest, deps);
    expect(result).toEqual({
      ok: true,
      credential: {
        source: 'shared',
        projectId: 'alphaci',
        environment: 'live',
        displayName: 'AlphaCI',
        clientId: 'shared-client-id',
        clientSecret: 'shared-client-secret',
        redirectUri: 'https://alphaci.com/callback',
      },
    });
    expect(reads).toEqual([]);
  });

  it('defaults to the first registered redirect URI and accepts another registered one', async () => {
    const { deps } = dependencies([registration()]);
    const defaulted = await resolveGoogleOAuthCredential(liveRequest, deps);
    const second = await resolveGoogleOAuthCredential(
      { ...liveRequest, redirectUri: 'https://staging.alphaci.com/callback' },
      deps,
    );
    expect(defaulted).toMatchObject({ ok: true, credential: { redirectUri: 'https://alphaci.com/callback' } });
    expect(second).toMatchObject({ ok: true, credential: { redirectUri: 'https://staging.alphaci.com/callback' } });
  });

  it('rejects a redirect URI the registration does not list', async () => {
    const { deps } = dependencies([registration()]);
    const result = await resolveGoogleOAuthCredential(
      { ...liveRequest, redirectUri: 'https://evil.example/callback' },
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400, code: 'REDIRECT_URI_NOT_REGISTERED' });
  });

  it('reports an unreadable client secret instead of falling back to the shared client', async () => {
    const { deps } = dependencies([registration({ clientId: 'alphaci-client-id', clientSecretRef: ownSecretRef })]);
    const result = await resolveGoogleOAuthCredential(liveRequest, deps);
    expect(result).toMatchObject({ ok: false, status: 503, code: 'OAUTH_CLIENT_SECRET_UNAVAILABLE' });
  });

  it('requires a project and a known environment', async () => {
    const { deps } = dependencies([registration()]);
    await expect(resolveGoogleOAuthCredential({ projectId: null, environment: 'live' }, deps)).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: 'INVALID_PROJECT_CONTEXT',
    });
    await expect(resolveGoogleOAuthCredential({ projectId: 'alphaci', environment: 'staging' }, deps)).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: 'INVALID_PROJECT_CONTEXT',
    });
  });
});

describe('SecretManagerClientSecretReader', () => {
  it('serves a secret from memory for five minutes, then reads the current version again', async () => {
    let now = 0;
    let secretValue: string | Uint8Array = 'first-secret';
    const requested: string[] = [];
    const client: SecretVersionAccessor = {
      async accessSecretVersion({ name }) {
        requested.push(name);
        return [{ payload: { data: secretValue } }];
      },
    };
    const reader = new SecretManagerClientSecretReader({ client, now: () => now });

    expect(await reader.read(ownSecretRef)).toBe('first-secret');
    now = 5 * 60 * 1000 - 1;
    expect(await reader.read(ownSecretRef)).toBe('first-secret');
    expect(requested).toHaveLength(1);

    now = 5 * 60 * 1000;
    secretValue = Buffer.from('rotated-secret');
    expect(await reader.read(ownSecretRef)).toBe('rotated-secret');
    expect(requested).toEqual([ownSecretRef, ownSecretRef]);
  });
});
