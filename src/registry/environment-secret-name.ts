import type { ApicenterRuntimeEnvironment } from "../types";

export const DEFAULT_TRIBE_SECRET_PREFIX = "api-center-tribe-secret-";
const SECRET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export function normalizeTribeSecretId(tribeId: string): string {
  const normalized = tribeId.trim().toLowerCase();
  if (!SECRET_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid tribeId for Secret Manager lookup: ${tribeId}`);
  }
  return normalized;
}

export function buildEnvironmentSecretId(
  tribeId: string,
  environment: ApicenterRuntimeEnvironment,
  prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_TRIBE_SECRET_PREFIX,
): string {
  return `${prefix}${normalizeTribeSecretId(tribeId)}-${environment}`;
}