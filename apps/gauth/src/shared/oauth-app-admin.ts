import { timingSafeEqual, createHash } from "node:crypto";
import type { Request, Response } from "express";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type {
  GauthEnvironment,
  OAuthAppRecord,
  OAuthAppStore,
} from "./oauth-app-store";
import { parseGauthEnvironment } from "./oauth-app-store";

type SecretResource = { name?: string };
type SecretVersion = {
  name?: string;
  payload?: { data?: string | Uint8Array | null } | null;
} | null;
export interface OAuthAdminSecretManager {
  createSecret(request: {
    parent: string;
    secretId: string;
    secret: { replication: { automatic: Record<string, never> } };
  }): Promise<[SecretResource, ...unknown[]]>;
  accessSecretVersion(request: {
    name: string;
  }): Promise<[SecretVersion, ...unknown[]]>;
  addSecretVersion(request: {
    parent: string;
    payload: { data: Buffer };
  }): Promise<[SecretResource, ...unknown[]]>;
  deleteSecret(request: { name: string }): Promise<unknown>;
}

export interface OAuthAppAdminDependencies {
  store: OAuthAppStore;
  expectedToken: string | undefined;
  secretManager?: OAuthAdminSecretManager;
  cloudProjectId?: string;
  now?: () => Date;
}

const notFound = (error: unknown) => (error as { code?: number })?.code === 5;
const alreadyExists = (error: unknown) =>
  (error as { code?: number })?.code === 6;
let liveSecretManager: OAuthAdminSecretManager | undefined;

export function createOAuthAppAdminHandler(deps: OAuthAppAdminDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const adminHeader = req.headers["x-apicenter-gauth-admin-token"];
    const adminToken =
      typeof adminHeader === "string" ? adminHeader : undefined;
    if (!constantTimeTokenMatches(adminToken, deps.expectedToken)) {
      res
        .status(401)
        .json({
          error: "UNAUTHORIZED",
          message: "GAuth admin token is invalid.",
        });
      return;
    }

    const projectParam = req.params.projectId;
    const projectId =
      typeof projectParam === "string" ? projectParam : undefined;
    const environment = parseGauthEnvironment(req.params.environment);
    if (!isSafeProjectId(projectId) || !environment) {
      res
        .status(400)
        .json({
          error: "INVALID_OAUTH_APP_ID",
          message: "Project or environment is invalid.",
        });
      return;
    }

    try {
      if (req.method === "GET") {
        const record = await deps.store.findByProjectAndEnvironment(
          projectId,
          environment,
        );
        res.status(200).json({
          projectId,
          environment,
          redirectUris: record?.redirectUris ?? [],
          displayName: record?.displayName ?? "",
          hasOwnClient: Boolean(record?.clientId && record.clientSecretRef),
          clientId: record?.clientId ?? null,
          secretLastChangedAt: record?.clientSecretUpdatedAt ?? null,
        });
        return;
      }

      if (req.method === "DELETE") {
        const existing = await deps.store.findByProjectAndEnvironment(
          projectId,
          environment,
        );
        await deps.store.delete(projectId, environment);
        if (existing?.clientSecretRef)
          await deleteSecret(deps, projectId, environment);
        res.status(204).end();
        return;
      }

      if (req.method !== "PUT") {
        res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
        return;
      }

      const input = validateOAuthAppInput(req.body, environment);
      if (!input.ok) {
        res
          .status(400)
          .json({ error: "INVALID_OAUTH_APP", message: input.message });
        return;
      }
      const existing = await deps.store.findByProjectAndEnvironment(
        projectId,
        environment,
      );
      const resolvedClientId =
        input.clientId === undefined
          ? (existing?.clientId ?? null)
          : input.clientId;
      let secretRef = resolvedClientId
        ? (existing?.clientSecretRef ?? null)
        : null;
      let secretChangedAt = resolvedClientId
        ? (existing?.clientSecretUpdatedAt ?? null)
        : null;

      if (input.clientSecret !== undefined) {
        if (!resolvedClientId) {
          res
            .status(400)
            .json({
              error: "INVALID_OAUTH_APP",
              message: "A clientId is required when setting a client secret.",
            });
          return;
        }
        const result = await writeSecretIfChanged(
          deps,
          projectId,
          environment,
          input.clientSecret,
        );
        secretRef = result.secretRef;
        secretChangedAt = result.changed
          ? (deps.now?.() ?? new Date()).toISOString()
          : secretChangedAt;
      } else if (
        resolvedClientId &&
        (!existing?.clientId ||
          resolvedClientId !== existing.clientId ||
          !secretRef)
      ) {
        res
          .status(400)
          .json({
            error: "CLIENT_SECRET_REQUIRED",
            message:
              "Provide a client secret when adding or changing a clientId.",
          });
        return;
      }

      const removeSecret =
        !resolvedClientId && Boolean(existing?.clientSecretRef);

      const record: OAuthAppRecord = {
        projectId,
        environment,
        redirectUris: input.redirectUris,
        clientId: resolvedClientId,
        clientSecretRef: secretRef,
        clientSecretUpdatedAt: secretChangedAt,
        displayName: input.displayName,
        status: "active",
      };
      await deps.store.save(record);
      if (removeSecret) await deleteSecret(deps, projectId, environment);
      res.status(200).json({
        projectId,
        environment,
        redirectUris: record.redirectUris,
        displayName: record.displayName,
        hasOwnClient: Boolean(record.clientId && record.clientSecretRef),
        clientId: record.clientId,
        secretLastChangedAt: record.clientSecretUpdatedAt ?? null,
      });
    } catch {
      res
        .status(503)
        .json({
          error: "OAUTH_APP_ADMIN_UNAVAILABLE",
          message: "Google sign-in settings could not be updated.",
        });
    }
  };
}

export function constantTimeTokenMatches(
  candidate: string | undefined,
  expected: string | undefined,
): boolean {
  if (!candidate || !expected) return false;
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function validateOAuthAppInput(
  body: unknown,
  environment: GauthEnvironment,
):
  | {
      ok: true;
      redirectUris: string[];
      displayName: string;
      clientId?: string | null;
      clientSecret?: string;
    }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, message: "Expected a JSON object." };
  const value = body as Record<string, unknown>;
  if (
    !Array.isArray(value.redirectUris) ||
    value.redirectUris.length < 1 ||
    value.redirectUris.length > 10
  ) {
    return { ok: false, message: "Provide between 1 and 10 redirect URIs." };
  }
  if (
    value.redirectUris.some(
      (uri) => typeof uri !== "string" || !validRedirectUri(uri, environment),
    )
  ) {
    return {
      ok: false,
      message: "Redirect URIs must use https; test may use http://localhost.",
    };
  }
  if (
    value.displayName !== undefined &&
    (typeof value.displayName !== "string" ||
      value.displayName.trim().length > 120)
  ) {
    return {
      ok: false,
      message: "displayName must be a string of at most 120 characters.",
    };
  }
  if (
    value.clientId !== undefined &&
    value.clientId !== null &&
    (typeof value.clientId !== "string" ||
      !value.clientId.trim() ||
      value.clientId.length > 512)
  ) {
    return { ok: false, message: "clientId must be a non-empty string." };
  }
  if (
    value.clientSecret !== undefined &&
    (typeof value.clientSecret !== "string" ||
      !value.clientSecret ||
      value.clientSecret.length > 4096)
  ) {
    return { ok: false, message: "clientSecret must be a non-empty string." };
  }
  return {
    ok: true,
    redirectUris: [...new Set(value.redirectUris as string[])],
    displayName:
      typeof value.displayName === "string" && value.displayName.trim()
        ? value.displayName.trim()
        : "Google sign-in",
    ...(Object.prototype.hasOwnProperty.call(value, "clientId")
      ? {
          clientId:
            typeof value.clientId === "string" ? value.clientId.trim() : null,
        }
      : {}),
    ...(typeof value.clientSecret === "string"
      ? { clientSecret: value.clientSecret }
      : {}),
  };
}

function validRedirectUri(
  value: string,
  environment: GauthEnvironment,
): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash) return false;
    return (
      parsed.protocol === "https:" ||
      (environment === "test" &&
        parsed.protocol === "http:" &&
        parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function isSafeProjectId(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function secretManager(
  deps: OAuthAppAdminDependencies,
): OAuthAdminSecretManager {
  if (deps.secretManager) return deps.secretManager;
  liveSecretManager ??= new SecretManagerServiceClient() as unknown as OAuthAdminSecretManager;
  return liveSecretManager;
}

function secretName(
  deps: OAuthAppAdminDependencies,
  projectId: string,
  environment: GauthEnvironment,
): string {
  const cloudProjectId =
    process.env.GAUTH_SECRETS_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    deps.cloudProjectId;
  if (!cloudProjectId)
    throw new Error("Google Cloud project ID is not configured.");
  return `projects/${cloudProjectId}/secrets/apic-gauth-${projectId}-${environment}`;
}

async function writeSecretIfChanged(
  deps: OAuthAppAdminDependencies,
  projectId: string,
  environment: GauthEnvironment,
  secretValue: string,
): Promise<{ secretRef: string; changed: boolean }> {
  const client = secretManager(deps);
  const parent = secretName(deps, projectId, environment);
  const resourceParent = parent.slice(0, parent.lastIndexOf("/secrets/"));
  try {
    await client.createSecret({
      parent: resourceParent,
      secretId: parent.split("/").at(-1)!,
      secret: { replication: { automatic: {} } },
    });
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
  let latestValue: string | null = null;
  let latestName: string | null = null;
  try {
    const [latest] = await client.accessSecretVersion({
      name: `${parent}/versions/latest`,
    });
    latestName = latest?.name ?? null;
    const data = latest?.payload?.data;
    latestValue =
      typeof data === "string"
        ? data
        : data
          ? Buffer.from(data).toString("utf8")
          : null;
  } catch (error) {
    if (!notFound(error)) throw error;
  }
  if (latestValue === secretValue && latestName)
    return { secretRef: latestName, changed: false };
  const [version] = await client.addSecretVersion({
    parent,
    payload: { data: Buffer.from(secretValue, "utf8") },
  });
  if (!version?.name)
    throw new Error("Secret Manager did not return the new version name.");
  return { secretRef: version.name, changed: true };
}

async function deleteSecret(
  deps: OAuthAppAdminDependencies,
  projectId: string,
  environment: GauthEnvironment,
): Promise<void> {
  const name = secretName(deps, projectId, environment);
  try {
    await secretManager(deps).deleteSecret({ name });
  } catch (error) {
    if (!notFound(error)) throw error;
  }
}
