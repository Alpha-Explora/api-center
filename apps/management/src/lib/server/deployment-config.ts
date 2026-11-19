import { normalizeManagementEnvironment } from "@/lib/management-environment";

export type DeploymentAuthMode = "local-dev" | "google";

export type DeploymentConfigCheck = {
  isDeployed: boolean;
  /** A deployed console must sign people in with Google; local-dev auth is refused there. */
  deployedLocalDevBlocked: boolean;
  authMode: DeploymentAuthMode;
  managementEnvironment: "local" | "test" | "live";
  publicBaseUrl: string;
  apiCenterBaseUrl: string;
  requiredEnv: string[];
  missingEnv: string[];
};

type EnvLike = Record<string, string | undefined>;

const REQUIRED_BASE_ENV = [
  "API_CENTER_BASE_URL",
  "API_CENTER_PLATFORM_ADMIN_SECRET",
  "NEXT_PUBLIC_API_CENTER_BASE_URL",
  "MANAGEMENT_AUTH_MODE",
  "MANAGEMENT_ENVIRONMENT",
  "NEXT_PUBLIC_MANAGEMENT_ENV",
];
const REQUIRED_GOOGLE_ENV = ["NEXT_PUBLIC_GOOGLE_CLIENT_ID"];
const REQUIRED_DEPLOYED_ENV = ["MANAGEMENT_PUBLIC_BASE_URL"];

export function getDeploymentConfigCheck(env: EnvLike = process.env): DeploymentConfigCheck {
  const authMode = getDeploymentAuthMode(env);
  const isDeployed = isDeployedRuntime(env);
  const requiredEnv = [
    ...REQUIRED_BASE_ENV,
    ...(authMode === "google" ? REQUIRED_GOOGLE_ENV : []),
    ...(isDeployed ? REQUIRED_DEPLOYED_ENV : []),
  ];
  return {
    isDeployed,
    deployedLocalDevBlocked: isDeployed && authMode === "local-dev",
    authMode,
    managementEnvironment: normalizeManagementEnvironment(
      env.MANAGEMENT_ENVIRONMENT || env.MANAGEMENT_ENV || env.NEXT_PUBLIC_MANAGEMENT_ENV || env.APP_ENV,
    ).key,
    publicBaseUrl: trim(env.MANAGEMENT_PUBLIC_BASE_URL),
    apiCenterBaseUrl: trim(env.API_CENTER_BASE_URL),
    requiredEnv,
    missingEnv: requiredEnv.filter((key) => !trim(env[key])),
  };
}

export function getDeploymentAuthMode(env: EnvLike = process.env): DeploymentAuthMode {
  return env.MANAGEMENT_AUTH_MODE === "google" ? "google" : "local-dev";
}

/** Deployed means Cloud Run (which always sets K_SERVICE) or any non-local public base URL. */
export function isDeployedRuntime(env: EnvLike = process.env) {
  if (trim(env.K_SERVICE)) return true;
  const publicBaseUrl = trim(env.MANAGEMENT_PUBLIC_BASE_URL);
  if (!publicBaseUrl || publicBaseUrl.includes("<")) return false;
  try {
    const hostname = new URL(publicBaseUrl).hostname.toLowerCase();
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
  } catch {
    return false;
  }
}

function trim(value: string | undefined) {
  return value?.trim() ?? "";
}
