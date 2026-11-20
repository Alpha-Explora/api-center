// Where a webhook destination's URL and signing secrets live: one Secret Manager secret per
// destination, `apicenter-webhook-<destinationId>`. The delivery service (apps/webhooks) reads it;
// the gateway is the only writer. Signing secrets never touch the database.
import { randomBytes } from "node:crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export interface WebhookDestinationConfig {
  url: string;
  /** Newest first. A rotated-out secret keeps signing until expiresAt so consumers can switch. */
  secrets: Array<{ value: string; expiresAt?: string }>;
  disabled?: boolean;
  /** Event types the delivery service delivers; missing delivers every type. */
  eventTypes?: string[];
}

export interface WebhookConfigStore {
  read(destinationId: string): Promise<WebhookDestinationConfig | null>;
  write(destinationId: string, config: WebhookDestinationConfig): Promise<void>;
}

export const WEBHOOK_CONFIG_STORE = Symbol("WEBHOOK_CONFIG_STORE");

export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

export function webhookSecretName(destinationId: string): string {
  return `apicenter-webhook-${destinationId}`;
}

type SecretClient = Pick<
  SecretManagerServiceClient,
  "accessSecretVersion" | "createSecret" | "addSecretVersion" | "listSecretVersions" | "destroySecretVersion"
>;

/**
 * Each write adds a version and destroys the older ones, so a destination holds exactly one billed
 * version and a replaced secret cannot be read back.
 */
export function createSecretManagerWebhookConfigStore(projectId: string, client: SecretClient = new SecretManagerServiceClient()): WebhookConfigStore {
  const secretPath = (destinationId: string) => `projects/${projectId}/secrets/${webhookSecretName(destinationId)}`;
  return {
    async read(destinationId) {
      try {
        const [version] = await client.accessSecretVersion({ name: `${secretPath(destinationId)}/versions/latest` });
        const data = version.payload?.data;
        return data ? (JSON.parse(Buffer.from(data as Uint8Array).toString("utf8")) as WebhookDestinationConfig) : null;
      } catch (error) {
        if ((error as { code?: number }).code === 5) return null;
        throw error;
      }
    },
    async write(destinationId, config) {
      try {
        await client.createSecret({
          parent: `projects/${projectId}`,
          secretId: webhookSecretName(destinationId),
          secret: { replication: { automatic: {} }, labels: { apicenter: "webhook-destination" } },
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 6) throw error; // 6 = ALREADY_EXISTS
      }
      const [added] = await client.addSecretVersion({
        parent: secretPath(destinationId),
        payload: { data: Buffer.from(JSON.stringify(config), "utf8") },
      });
      const [versions] = await client.listSecretVersions({ parent: secretPath(destinationId), filter: "state:ENABLED" });
      for (const version of versions) {
        if (version.name && version.name !== added.name) await client.destroySecretVersion({ name: version.name });
      }
    },
  };
}

/** For local runs and tests: configs held in this process. */
export function createMemoryWebhookConfigStore(): WebhookConfigStore & { configs: Map<string, WebhookDestinationConfig> } {
  const configs = new Map<string, WebhookDestinationConfig>();
  return {
    configs,
    async read(destinationId) {
      const config = configs.get(destinationId);
      return config ? structuredClone(config) : null;
    },
    async write(destinationId, config) {
      configs.set(destinationId, structuredClone(config));
    },
  };
}
