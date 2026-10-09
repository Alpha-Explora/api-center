import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export interface ClientSecretReader {
  read(secretRef: string): Promise<string>;
}

type SecretVersionResponse = { payload?: { data?: string | Uint8Array | null } | null } | null | undefined;

export interface SecretVersionAccessor {
  accessSecretVersion(request: { name: string }): Promise<[SecretVersionResponse, ...unknown[]]>;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Reads a team's Google client secret from Secret Manager. Each value is cached in memory for up to five
 * minutes, so a rotated secret is picked up within that window without a redeploy.
 */
export class SecretManagerClientSecretReader implements ClientSecretReader {
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly injectedClient: SecretVersionAccessor | undefined;
  private liveClient: SecretVersionAccessor | undefined;

  constructor(options: { client?: SecretVersionAccessor; cacheTtlMs?: number; now?: () => number } = {}) {
    this.injectedClient = options.client;
    this.cacheTtlMs = options.cacheTtlMs ?? FIVE_MINUTES_MS;
    this.now = options.now ?? Date.now;
  }

  async read(secretRef: string): Promise<string> {
    const now = this.now();
    const cached = this.cache.get(secretRef);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const client = this.client();
    const [version] = await client.accessSecretVersion({ name: secretRef });
    const data = version?.payload?.data;
    const value = typeof data === 'string' ? data : data ? Buffer.from(data).toString('utf8') : '';
    if (!value) {
      throw new Error('Secret Manager returned an empty client secret.');
    }

    this.cache.set(secretRef, { value, expiresAt: now + this.cacheTtlMs });
    return value;
  }

  /** The real client is created on first use, so importing this module does not need Google credentials. */
  private client(): SecretVersionAccessor {
    if (this.injectedClient) {
      return this.injectedClient;
    }
    if (!this.liveClient) {
      this.liveClient = new SecretManagerServiceClient() as unknown as SecretVersionAccessor;
    }
    return this.liveClient;
  }
}
