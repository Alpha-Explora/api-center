import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

export const GCP_SECRETS_LOADED_FLAG = "APICENTER_GCP_SECRETS_LOADED";

type SecretLoadLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type SecretLoadResult = {
  loaded: number;
  total: number;
};

const consoleLogger: SecretLoadLogger = {
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
};

function normalizeJsonPayload(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

export async function loadGcpSecretsIntoEnv(
  logger: SecretLoadLogger = consoleLogger,
): Promise<SecretLoadResult> {
  if (process.env[GCP_SECRETS_LOADED_FLAG] === "true") {
    return { loaded: 0, total: 0 };
  }

  const secretName = process.env.GCP_SECRET_NAME;
  const projectId =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const version = process.env.GCP_SECRET_VERSION || "latest";

  if (!secretName) {
    logger.info("GCP_SECRET_NAME not set - using process.env values only");
    return { loaded: 0, total: 0 };
  }

  if (!projectId) {
    logger.warn(
      "GCP secret loading skipped - set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT",
    );
    return { loaded: 0, total: 0 };
  }

  try {
    const resourceName = `projects/${projectId}/secrets/${secretName}/versions/${version}`;
    logger.info(`Loading secrets from GCP Secret Manager: ${resourceName}`);

    const client = new SecretManagerServiceClient();
    const [response] = await client.accessSecretVersion({ name: resourceName });
    const payload = response.payload?.data;

    if (!payload) {
      logger.warn(`GCP secret '${secretName}' returned an empty payload`);
      return { loaded: 0, total: 0 };
    }

    const raw = Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : String(payload);
    const normalized = normalizeJsonPayload(raw);
    const secrets = JSON.parse(normalized) as Record<string, string>;

    let loaded = 0;
    for (const [key, value] of Object.entries(secrets)) {
      if (!process.env[key]) {
        process.env[key] = value;
        loaded++;
      }
    }

    process.env[GCP_SECRETS_LOADED_FLAG] = "true";
    logger.info(
      `Loaded ${loaded} secret(s) from GCP Secret Manager (${Object.keys(secrets).length} total, ${Object.keys(secrets).length - loaded} already set)`,
    );

    return { loaded, total: Object.keys(secrets).length };
  } catch (error) {
    logger.warn(
      `GCP Secret Manager unavailable - using process.env only: ${(error as Error).message}`,
    );
    return { loaded: 0, total: 0 };
  }
}
