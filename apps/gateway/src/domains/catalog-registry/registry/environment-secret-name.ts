import type { ApicenterRuntimeEnvironment } from "../../../types";

/** Per-service credential secrets. TRIBE_SECRET_GCP_PREFIX keeps its historical name as the deploy knob. */
export const DEFAULT_ENVIRONMENT_SECRET_PREFIX = "api-center-service-secret-";
const SECRET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export function normalizeServiceSecretId(serviceId: string): string {
  const normalized = serviceId.trim().toLowerCase();
  if (!SECRET_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid serviceId for Secret Manager lookup: ${serviceId}`);
  }
  return normalized;
}

export function buildEnvironmentSecretId(
  serviceId: string,
  environment: ApicenterRuntimeEnvironment,
  prefix =
    process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_ENVIRONMENT_SECRET_PREFIX,
): string {
  return `${prefix}${normalizeServiceSecretId(serviceId)}-${environment}`;
}
