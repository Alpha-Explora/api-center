import { normalizeManagementEnvironment } from "@/lib/management-environment";

export type DeploymentAuthMode = "local-dev" | "google";
export type SecretManagerAuthMode =
  | "vercel-oidc"
  | "local-impersonation"
  | "service-account-file"
  | "missing";

export type DeploymentConfigCheck = {
  isDeployed: boolean;
  deployedLocalDevBlocked: boolean;
  authMode: DeploymentAuthMode;
  managementEnvironment: "local" | "test" | "live";
  managementEnv: string;
  publicBaseUrl: string;
  apiCenterBaseUrl: string;
  publicApiCenterBaseUrl: string;
  oneApiCenterTopology: {
    usesSingleApiCenterBaseUrl: boolean;
    managedTargetEnvironments: readonly ["test", "live"];
  };
  kafkaTopicPrefix: string;
  googleCloudProject: string;
  secretManagerAuthMode: SecretManagerAuthMode;
  google: {
    clientId: string;
    publicClientId: string;
  };
  gcp: {
    projectNumber: string;
    serviceAccountEmail: string;
    workloadIdentityPoolId: string;
    workloadIdentityPoolProviderId: string;
  };
  confluent: {
    environmentId: string;
    kafkaClusterId: string;
    kafkaRestEndpoint: string;
    s3ConnectorName: string;
    defaultRetentionMs: string;
  };
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
  "NEXT_PUBLIC_KAFKA_TOPIC_PREFIX",
  "GOOGLE_CLOUD_PROJECT",
  "CONFLUENT_ENVIRONMENT_ID",
  "CONFLUENT_KAFKA_CLUSTER_ID",
  "CONFLUENT_KAFKA_REST_ENDPOINT",
  "CONFLUENT_KAFKA_API_KEY",
  "CONFLUENT_KAFKA_API_SECRET",
  "CONFLUENT_CLOUD_API_KEY",
  "CONFLUENT_CLOUD_API_SECRET",
  "CONFLUENT_S3_CONNECTOR_NAME",
];

const REQUIRED_GOOGLE_ENV = [
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
];

const REQUIRED_DEPLOYED_ENV = [
  "MANAGEMENT_PUBLIC_BASE_URL",
  "PLATFORM_ADMIN_EMAILS",
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
];

export function getDeploymentConfigCheck(
  env: EnvLike = process.env,
): DeploymentConfigCheck {
  const authMode = getDeploymentAuthMode(env);
  const managementEnvironment = normalizeManagementEnvironment(
    env.MANAGEMENT_ENVIRONMENT ||
      env.MANAGEMENT_ENV ||
      env.NEXT_PUBLIC_MANAGEMENT_ENV ||
      env.APP_ENV,
  );
  const publicBaseUrl = trim(env.MANAGEMENT_PUBLIC_BASE_URL);
  const isDeployed = isDeployedRuntime(env);
  const requiredEnv = getRequiredEnv(authMode, isDeployed);
  const missingEnv = requiredEnv.filter((key) => !trim(env[key]));
  const secretManagerAuthMode = getSecretManagerAuthMode(env);
  const apiCenterBaseUrl = trim(env.API_CENTER_BASE_URL);
  const publicApiCenterBaseUrl = trim(env.NEXT_PUBLIC_API_CENTER_BASE_URL);

  return {
    isDeployed,
    deployedLocalDevBlocked: isDeployed && authMode === "local-dev",
    authMode,
    managementEnvironment: managementEnvironment.key,
    managementEnv: trim(
      env.MANAGEMENT_ENVIRONMENT ||
        env.MANAGEMENT_ENV ||
        env.NEXT_PUBLIC_MANAGEMENT_ENV ||
        env.APP_ENV,
    ),
    publicBaseUrl,
    apiCenterBaseUrl,
    publicApiCenterBaseUrl,
    oneApiCenterTopology: {
      usesSingleApiCenterBaseUrl:
        normalizeUrl(apiCenterBaseUrl) === normalizeUrl(publicApiCenterBaseUrl),
      managedTargetEnvironments: ["test", "live"],
    },
    kafkaTopicPrefix: getKafkaTopicPrefixFromEnv(env),
    googleCloudProject: trim(
      env.GOOGLE_CLOUD_PROJECT ||
        env.GCP_PROJECT_ID ||
        env.API_CENTER_GCP_PROJECT_ID ||
        env.GCLOUD_PROJECT,
    ),
    secretManagerAuthMode,
    google: {
      clientId: trim(env.GOOGLE_CLIENT_ID),
      publicClientId: trim(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID),
    },
    gcp: {
      projectNumber: trim(env.GCP_PROJECT_NUMBER),
      serviceAccountEmail: trim(env.GCP_SERVICE_ACCOUNT_EMAIL),
      workloadIdentityPoolId: trim(env.GCP_WORKLOAD_IDENTITY_POOL_ID),
      workloadIdentityPoolProviderId: trim(
        env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
      ),
    },
    confluent: {
      environmentId: trim(env.CONFLUENT_ENVIRONMENT_ID),
      kafkaClusterId: trim(env.CONFLUENT_KAFKA_CLUSTER_ID),
      kafkaRestEndpoint: trim(env.CONFLUENT_KAFKA_REST_ENDPOINT),
      s3ConnectorName: trim(env.CONFLUENT_S3_CONNECTOR_NAME),
      defaultRetentionMs: trim(env.CONFLUENT_DEFAULT_RETENTION_MS),
    },
    requiredEnv,
    missingEnv,
  };
}

export function getDeploymentAuthMode(env: EnvLike = process.env) {
  return env.MANAGEMENT_AUTH_MODE === "google" ? "google" : "local-dev";
}

export function isDeployedRuntime(env: EnvLike = process.env) {
  if (env.VERCEL === "1" || trim(env.VERCEL_URL)) {
    return true;
  }

  const publicBaseUrl = trim(env.MANAGEMENT_PUBLIC_BASE_URL);
  if (!publicBaseUrl || publicBaseUrl.includes("<")) {
    return false;
  }

  try {
    const hostname = new URL(publicBaseUrl).hostname.toLowerCase();
    return (
      hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1"
    );
  } catch {
    return false;
  }
}

function getRequiredEnv(authMode: DeploymentAuthMode, isDeployed: boolean) {
  return [
    ...REQUIRED_BASE_ENV,
    ...(authMode === "google" ? REQUIRED_GOOGLE_ENV : []),
    ...(isDeployed ? REQUIRED_DEPLOYED_ENV : []),
  ];
}

function getSecretManagerAuthMode(env: EnvLike): SecretManagerAuthMode {
  const hasVercelOidcConfig =
    trim(env.GCP_PROJECT_NUMBER) &&
    trim(env.GCP_SERVICE_ACCOUNT_EMAIL) &&
    trim(env.GCP_WORKLOAD_IDENTITY_POOL_ID) &&
    trim(env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID);

  if (isDeployedRuntime(env) && hasVercelOidcConfig) {
    return "vercel-oidc";
  }

  if (
    trim(env.GCP_IMPERSONATE_SERVICE_ACCOUNT) ||
    trim(env.API_CENTER_GCP_IMPERSONATE_SERVICE_ACCOUNT)
  ) {
    return "local-impersonation";
  }

  if (trim(env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return "service-account-file";
  }

  return "missing";
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function getKafkaTopicPrefixFromEnv(env: EnvLike) {
  return (env.NEXT_PUBLIC_KAFKA_TOPIC_PREFIX || env.KAFKA_TOPIC_PREFIX || "")
    .trim()
    .replace(/\.+$/, "");
}

function trim(value: string | undefined) {
  return value?.trim() ?? "";
}
