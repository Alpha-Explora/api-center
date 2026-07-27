import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { getVercelOidcToken } from "@vercel/oidc";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ExternalAccountClient } from "google-auth-library";
import { isDeployedRuntime } from "./deployment-config";

const TOKEN_URL = "https://sts.googleapis.com/v1/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SERVICE_ACCOUNT_EMAIL_PATTERN =
  /^[a-z][a-z0-9-]{4,28}@[a-z][a-z0-9-]{4,28}\.iam\.gserviceaccount\.com$/;
const execFileAsync = promisify(execFile);

export function createSecretManagerClient() {
  const vercelAuthClient = createVercelAuthClient();

  if (!vercelAuthClient) {
    return new SecretManagerServiceClient();
  }

  return new SecretManagerServiceClient({
    authClient: vercelAuthClient,
    projectId: getProjectId(),
  });
}

export function getSecretManagerAuthReadiness() {
  if (hasUsableVercelOidcConfig()) {
    return { ok: true as const };
  }

  const explicitCredentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicitCredentialPath) {
    return existsSync(explicitCredentialPath)
      ? { ok: true as const }
      : {
          ok: false as const,
          message:
            "GOOGLE_APPLICATION_CREDENTIALS points to a file that does not exist.",
        };
  }

  if (getApplicationDefaultCredentialPath()) {
    return { ok: true as const };
  }

  if (shouldUseLocalGcloudImpersonation()) {
    return { ok: true as const };
  }

  return {
    ok: false as const,
    message:
      "Google credentials are missing. Set GCP_IMPERSONATE_SERVICE_ACCOUNT for local gcloud impersonation or run `gcloud auth application-default login --project=apicenter-alpha-20260623`.",
  };
}

export function getLocalGcloudImpersonationServiceAccount() {
  const serviceAccount =
    process.env.GCP_IMPERSONATE_SERVICE_ACCOUNT ||
    process.env.API_CENTER_GCP_IMPERSONATE_SERVICE_ACCOUNT;

  if (!serviceAccount) {
    return null;
  }

  if (!SERVICE_ACCOUNT_EMAIL_PATTERN.test(serviceAccount)) {
    throw new Error("GCP_IMPERSONATE_SERVICE_ACCOUNT is not a valid service account email.");
  }

  return serviceAccount;
}

export function shouldUseLocalGcloudImpersonation() {
  return Boolean(
    getLocalGcloudImpersonationServiceAccount() && !hasUsableVercelOidcConfig(),
  );
}

export async function provisionSecretWithLocalGcloudImpersonation(input: {
  projectId: string;
  secretId: string;
  secretName: string;
  payload: string;
}) {
  const accessToken = await getLocalGcloudImpersonatedAccessToken();
  await ensureSecretViaRest({
    projectId: input.projectId,
    secretId: input.secretId,
    secretName: input.secretName,
    accessToken,
  });

  const data = await secretManagerFetch<{ name?: string }>(
    `https://secretmanager.googleapis.com/v1/${input.secretName}:addVersion`,
    {
      method: "POST",
      accessToken,
      body: {
        payload: {
          data: Buffer.from(input.payload, "utf8").toString("base64"),
        },
      },
    },
  );

  return {
    versionName: data?.name || "",
  };
}

export async function getTribeSecretStatus(input: {
  serviceId: string;
  secretId: string;
  secretName: string;
}) {
  if (!shouldUseLocalGcloudImpersonation()) {
    return getTribeSecretStatusWithClient(input);
  }

  const accessToken = await getLocalGcloudImpersonatedAccessToken();
  const secret = await secretManagerFetch<{ state?: string }>(
    `https://secretmanager.googleapis.com/v1/${input.secretName}`,
    {
      method: "GET",
      accessToken,
      allowNotFound: true,
    },
  );
  const latestVersion = secret
    ? await getLatestEnabledSecretVersion(input.secretName, accessToken)
    : null;

  return {
    serviceId: input.serviceId,
    secretId: input.secretId,
    expectedSecretId: input.secretId,
    exists: Boolean(secret),
    enabled: Boolean(secret) && secret?.state !== "DISABLED",
    state: secret?.state ?? (secret ? "ENABLED" : undefined),
    latestEnabledVersion: latestVersion?.versionNumber,
    latestVersionCreatedAt: latestVersion?.createTime,
  };
}

export async function accessLatestSecretPayload(secretName: string) {
  if (!shouldUseLocalGcloudImpersonation()) {
    return accessLatestSecretPayloadWithClient(secretName);
  }

  const accessToken = await getLocalGcloudImpersonatedAccessToken();
  const response = await secretManagerFetch<{
    payload?: {
      data?: string;
    };
  }>(`https://secretmanager.googleapis.com/v1/${secretName}/versions/latest:access`, {
    method: "GET",
    accessToken,
    allowNotFound: true,
  });

  const encodedPayload = response?.payload?.data;
  return encodedPayload ? Buffer.from(encodedPayload, "base64").toString("utf8") : null;
}
async function getTribeSecretStatusWithClient(input: {
  serviceId: string;
  secretId: string;
  secretName: string;
}) {
  const client = createSecretManagerClient();
  const secret = await getSecretWithClient(client, input.secretName);
  const latestVersion = secret
    ? await getLatestEnabledSecretVersionWithClient(client, input.secretName)
    : null;

  return {
    serviceId: input.serviceId,
    secretId: input.secretId,
    expectedSecretId: input.secretId,
    exists: Boolean(secret),
    enabled: Boolean(secret),
    state: secret ? "ENABLED" : undefined,
    latestEnabledVersion: latestVersion?.versionNumber,
    latestVersionCreatedAt: latestVersion?.createTime,
  };
}

async function accessLatestSecretPayloadWithClient(secretName: string) {
  const client = createSecretManagerClient();
  try {
    const [response] = await client.accessSecretVersion({
      name: `${secretName}/versions/latest`,
    });
    const rawPayload = response.payload?.data;
    if (!rawPayload) return null;

    return Buffer.isBuffer(rawPayload)
      ? rawPayload.toString("utf8")
      : Buffer.from(rawPayload).toString("utf8");
  } catch (error) {
    if (isSecretManagerNotFound(error)) {
      return null;
    }

    throw error;
  }
}
export async function deleteTribeSecret(input: {
  serviceId: string;
  secretId: string;
  secretName: string;
}) {
  if (!shouldUseLocalGcloudImpersonation()) {
    return deleteTribeSecretWithClient(input);
  }

  const accessToken = await getLocalGcloudImpersonatedAccessToken();
  const existing = await secretManagerFetch(
    `https://secretmanager.googleapis.com/v1/${input.secretName}`,
    {
      method: "GET",
      accessToken,
      allowNotFound: true,
    },
  );

  if (!existing) {
    return {
      serviceId: input.serviceId,
      secretId: input.secretId,
      action: "not-found" as const,
    };
  }

  await secretManagerFetch(`https://secretmanager.googleapis.com/v1/${input.secretName}`, {
    method: "DELETE",
    accessToken,
  });

  return {
    serviceId: input.serviceId,
    secretId: input.secretId,
    action: "deleted" as const,
  };
}

export function getProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.API_CENTER_GCP_PROJECT_ID ||
    process.env.GCLOUD_PROJECT
  );
}

function createVercelAuthClient() {
  if (!hasUsableVercelOidcConfig()) {
    return null;
  }

  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  const authClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: TOKEN_URL,
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    scopes: [CLOUD_PLATFORM_SCOPE],
    subject_token_supplier: {
      getSubjectToken: async () => getVercelOidcToken(),
    },
  });

  if (!authClient) {
    throw new Error("Unable to create Vercel OIDC Google auth client.");
  }

  return authClient;
}

async function getLocalGcloudImpersonatedAccessToken() {
  const serviceAccount = getLocalGcloudImpersonationServiceAccount();
  if (!serviceAccount) {
    throw new Error("GCP_IMPERSONATE_SERVICE_ACCOUNT is not configured.");
  }

  const { executable, args } = getGcloudPrintTokenCommand(serviceAccount);
  const { stdout } = await execFileAsync(executable, args, {
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const accessToken = stdout.trim();

  if (!accessToken) {
    throw new Error("Unable to mint a local gcloud impersonated access token.");
  }

  return accessToken;
}

function getGcloudPrintTokenCommand(serviceAccount: string) {
  const args = [
    "auth",
    "print-access-token",
    `--impersonate-service-account=${serviceAccount}`,
  ];

  if (process.platform === "win32") {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "gcloud.cmd", ...args],
    };
  }

  return {
    executable: "gcloud",
    args,
  };
}

async function ensureSecretViaRest(input: {
  projectId: string;
  secretId: string;
  secretName: string;
  accessToken: string;
}) {
  const existing = await secretManagerFetch(
    `https://secretmanager.googleapis.com/v1/${input.secretName}`,
    {
      method: "GET",
      accessToken: input.accessToken,
      allowNotFound: true,
    },
  );

  if (existing) {
    return;
  }

  await secretManagerFetch(
    `https://secretmanager.googleapis.com/v1/projects/${input.projectId}/secrets?secretId=${encodeURIComponent(input.secretId)}`,
    {
      method: "POST",
      accessToken: input.accessToken,
      body: {
        replication: {
          automatic: {},
        },
      },
    },
  );
}

async function getLatestEnabledSecretVersion(
  secretName: string,
  accessToken: string,
) {
  const versions = await secretManagerFetch<{
    versions?: Array<{
      name?: string;
      state?: string;
      createTime?: string;
    }>;
  }>(
    `https://secretmanager.googleapis.com/v1/${secretName}/versions?filter=state:ENABLED&pageSize=20`,
    {
      method: "GET",
      accessToken,
      allowNotFound: true,
    },
  );

  const latest = [...(versions?.versions ?? [])]
    .filter((version) => version.state === "ENABLED")
    .sort((left, right) =>
      String(right.createTime ?? "").localeCompare(String(left.createTime ?? "")),
    )[0];

  if (!latest?.name) return null;

  return {
    versionNumber: latest.name.split("/").pop(),
    createTime: latest.createTime,
  };
}

async function getSecretWithClient(
  client: SecretManagerServiceClient,
  secretName: string,
) {
  try {
    const [secret] = await client.getSecret({ name: secretName });
    return secret;
  } catch (error) {
    if (isSecretManagerNotFound(error)) {
      return null;
    }

    throw error;
  }
}

async function deleteTribeSecretWithClient(input: {
  serviceId: string;
  secretId: string;
  secretName: string;
}) {
  const client = createSecretManagerClient();
  const existing = await getSecretWithClient(client, input.secretName);

  if (!existing) {
    return {
      serviceId: input.serviceId,
      secretId: input.secretId,
      action: "not-found" as const,
    };
  }

  await client.deleteSecret({ name: input.secretName });

  return {
    serviceId: input.serviceId,
    secretId: input.secretId,
    action: "deleted" as const,
  };
}

async function getLatestEnabledSecretVersionWithClient(
  client: SecretManagerServiceClient,
  secretName: string,
) {
  try {
    const [versions] = await client.listSecretVersions({
      parent: secretName,
      filter: "state:ENABLED",
      pageSize: 20,
    });
    const latest = [...versions]
      .filter((version) => version.state === "ENABLED")
      .sort((left, right) =>
        normalizeSecretManagerTimestamp(right.createTime).localeCompare(
          normalizeSecretManagerTimestamp(left.createTime),
        ),
      )[0];

    if (!latest?.name) return null;

    return {
      versionNumber: latest.name.split("/").pop(),
      createTime: normalizeSecretManagerTimestamp(latest.createTime),
    };
  } catch (error) {
    if (isSecretManagerNotFound(error)) {
      return null;
    }

    throw error;
  }
}

function normalizeSecretManagerTimestamp(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const timestamp = value as { seconds?: unknown; nanos?: unknown };
    const seconds = Number(timestamp.seconds ?? 0);
    const nanos = Number(timestamp.nanos ?? 0);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
    }
  }

  return String(value);
}

function isSecretManagerNotFound(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 5 ||
    candidate.code === "5" ||
    (typeof candidate.message === "string" &&
      candidate.message.toLowerCase().includes("not found"))
  );
}

async function secretManagerFetch<T = unknown>(
  url: string,
  options: {
    method: "DELETE" | "GET" | "POST";
    accessToken: string;
    body?: unknown;
    allowNotFound?: boolean;
  },
): Promise<T | null> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (response.status === 404 && options.allowNotFound) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatSecretManagerRestError(response.status, text));
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
}

function formatSecretManagerRestError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; status?: unknown };
    };
    const message = parsed.error?.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  } catch {
    // Fall through to a safe HTTP summary.
  }

  return `Secret Manager request failed with HTTP ${status}.`;
}

function hasCompleteVercelOidcConfig() {
  return Boolean(
    process.env.GCP_PROJECT_NUMBER &&
      process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
  );
}

function hasUsableVercelOidcConfig() {
  return isDeployedRuntime(process.env) && hasCompleteVercelOidcConfig();
}

function getApplicationDefaultCredentialPath() {
  const candidates = [
    process.env.APPDATA
      ? join(
          process.env.APPDATA,
          "gcloud",
          "application_default_credentials.json",
        )
      : null,
    join(homedir(), ".config", "gcloud", "application_default_credentials.json"),
  ].filter((path): path is string => Boolean(path));

  return candidates.find((path) => existsSync(path));
}

