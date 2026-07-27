import {
  apiCenterAdminJson,
  getApiCenterAdminConfig,
} from "@/lib/server/api-center-admin";
import {
  getKafkaTopicPrefix,
  getManagementEnvironment,
} from "@/lib/management-environment";
import {
  getProjectId,
  getSecretManagerAuthReadiness,
} from "@/lib/server/gcp-secret-manager";
import { getDeploymentConfigCheck } from "@/lib/server/deployment-config";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export async function GET() {
  const config = getApiCenterAdminConfig();
  const managementEnvironment = getManagementEnvironment();
  const kafkaTopicPrefix = getKafkaTopicPrefix();
  const googleCloudProject = getProjectId() ?? "";
  const secretManagerAuth = readSecretManagerAuth();
  const deployment = getDeploymentConfigCheck();
  const checks = [];
  const missingEnv = [...deployment.missingEnv];

  addUniqueMissing(
    missingEnv,
    !config.hasApiCenterBaseUrl,
    "API_CENTER_BASE_URL",
  );
  addUniqueMissing(
    missingEnv,
    !config.hasPlatformSecret,
    "API_CENTER_PLATFORM_ADMIN_SECRET",
  );

  checks.push({
    key: "local-proxy",
    label: "Local proxy safety",
    ok: !config.exposesPlatformSecretToBrowser,
    detail: config.exposesPlatformSecretToBrowser
      ? "NEXT_PUBLIC_API_CENTER_PLATFORM_ADMIN_SECRET must not be set."
      : "Platform secret is not exposed through NEXT_PUBLIC env.",
  });

  checks.push({
    key: "deployment-auth-mode",
    label: "Deployment auth mode",
    ok: !deployment.deployedLocalDevBlocked,
    detail: deployment.deployedLocalDevBlocked
      ? "This deployed runtime is using local-dev auth. Set MANAGEMENT_AUTH_MODE=google and redeploy."
      : `${deployment.authMode} auth for ${
          deployment.isDeployed ? "deployed" : "local"
        } runtime.`,
  });

  checks.push({
    key: "deployment-required-env",
    label: "Deployment env vars",
    ok: deployment.missingEnv.length === 0,
    detail: deployment.missingEnv.length
      ? `Missing ${deployment.missingEnv.join(", ")}.`
      : "Required management deployment env vars are configured.",
  });

  checks.push({
    key: "google-auth-config",
    label: "Google auth config",
    ok:
      deployment.authMode === "local-dev" ||
      Boolean(deployment.google.publicClientId),
    detail:
      deployment.authMode === "local-dev"
        ? "Google sign-in is not required in local-dev auth mode."
        : deployment.google.publicClientId
          ? "Google client ID is configured."
          : "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID.",
  });

  const apiCenterHealth = await checkApiCenterHealth(
    `${config.apiCenterBaseUrl}/api/v1/health/ready`,
  );
  checks.push(apiCenterHealth.check);

  checks.push(await checkRegistryAccess());

  checks.push({
    key: "management-environment",
    label: "Management environment",
    ok: true,
    detail: `${managementEnvironment.label} target. Topic prefix: ${
      kafkaTopicPrefix || "none"
    }.`,
  });

  checks.push({
    key: "gcp-secret-manager",
    label: "GCP Secret Manager auth",
    ok: secretManagerAuth.ok,
    detail: `${deployment.secretManagerAuthMode}: ${secretManagerAuth.detail}`,
  });

  return Response.json({
    checkedAt: new Date().toISOString(),
    ok: checks.every((check) => check.ok) && missingEnv.length === 0,
    managementEnvironment: managementEnvironment.key,
    authMode: deployment.authMode,
    isDeployed: deployment.isDeployed,
    deployedLocalDevBlocked: deployment.deployedLocalDevBlocked,
    apiCenterBaseUrl: config.apiCenterBaseUrl,
    publicApiCenterBaseUrl: config.publicApiCenterBaseUrl,
    kafkaTopicPrefix,
    googleCloudProject,
    secretManagerAuthMode: deployment.secretManagerAuthMode,
    deployment,
    secretManagerAuth,
    missingEnv: [...new Set(missingEnv)],
    checks,
    governance: apiCenterHealth.governance,
  });
}

function addUniqueMissing(
  missingEnv: string[],
  shouldAdd: boolean,
  key: string,
) {
  if (shouldAdd && !missingEnv.includes(key)) {
    missingEnv.push(key);
  }
}

function readSecretManagerAuth() {
  try {
    const readiness = getSecretManagerAuthReadiness();
    return {
      ok: readiness.ok,
      detail: readiness.ok
        ? "Secret Manager auth source is configured."
        : readiness.message,
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error
          ? error.message
          : "Secret Manager auth check failed.",
    };
  }
}

async function checkApiCenterHealth(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = await readJson(response);

    return {
      check: {
        key: "api-center-health",
        label: "API Center readiness endpoint",
        ok: response.ok,
        detail: `GET ${url} returned HTTP ${response.status}.`,
      },
      governance: readGovernance(body),
    };
  } catch (error) {
    return {
      check: {
        key: "api-center-health",
        label: "API Center readiness endpoint",
        ok: false,
        detail: error instanceof Error ? error.message : "Health check failed.",
      },
      governance: undefined,
    };
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readGovernance(body: unknown) {
  const governance = (
    body as
      | {
          details?: { governance?: unknown };
          info?: { governance?: unknown };
        }
      | undefined
  )?.details?.governance;
  return (
    governance ??
    (body as { info?: { governance?: unknown } } | undefined)?.info?.governance
  );
}

async function checkRegistryAccess() {
  try {
    const response = await apiCenterAdminJson<{
      success: boolean;
      data: ServiceRegistryEntry[];
    }>("/api/v1/registry/services");

    return {
      key: "registry-access",
      label: "Protected registry access",
      ok: Array.isArray(response.data),
      detail: `Registry returned ${response.data?.length ?? 0} service(s).`,
    };
  } catch (error) {
    return {
      key: "registry-access",
      label: "Protected registry access",
      ok: false,
      detail:
        error instanceof Error
          ? error.message
          : "Protected registry request failed.",
    };
  }
}
