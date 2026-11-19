// Each webhook destination's URL and signing secrets live in one Secret Manager secret,
// `apicenter-webhook-<destinationId>`, written by the gateway. This service only reads them, so it
// needs no database. Configs are cached briefly so a burst of events costs one read.
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export interface DestinationConfig {
  url: string;
  /** Newest first. A rotated-out secret stays until its expiry so consumers can switch over. */
  secrets: Array<{ value: string; expiresAt?: string }>;
  /** Set when the destination is disabled: events are acknowledged and dropped. */
  disabled?: boolean;
}

export interface DestinationStore {
  get(destinationId: string): Promise<DestinationConfig | null>;
}

export const DESTINATION_ID = /^dst_[a-z0-9]{24}$/;

export function destinationSecretName(destinationId: string): string {
  return `apicenter-webhook-${destinationId}`;
}

/** Secrets still valid at `now`, newest first. */
export function activeSecrets(config: DestinationConfig, now = Date.now()): string[] {
  return config.secrets.filter((secret) => !secret.expiresAt || Date.parse(secret.expiresAt) > now).map((secret) => secret.value);
}

export function createSecretManagerDestinationStore(options: {
  projectId: string;
  client?: Pick<SecretManagerServiceClient, "accessSecretVersion">;
  cacheMs?: number;
}): DestinationStore {
  const client = options.client ?? new SecretManagerServiceClient();
  const cacheMs = options.cacheMs ?? 30_000;
  const cache = new Map<string, { config: DestinationConfig | null; until: number }>();

  return {
    async get(destinationId) {
      const cached = cache.get(destinationId);
      if (cached && cached.until > Date.now()) return cached.config;
      let config: DestinationConfig | null = null;
      try {
        const [version] = await client.accessSecretVersion({
          name: `projects/${options.projectId}/secrets/${destinationSecretName(destinationId)}/versions/latest`,
        });
        const raw = version.payload?.data;
        config = raw ? (JSON.parse(Buffer.from(raw as Uint8Array).toString("utf8")) as DestinationConfig) : null;
      } catch (error) {
        // NOT_FOUND means no such destination; anything else is transient and must be retried.
        if ((error as { code?: number }).code !== 5) throw error;
      }
      cache.set(destinationId, { config, until: Date.now() + cacheMs });
      return config;
    },
  };
}
