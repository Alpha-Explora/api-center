import type { ActionRisk } from "@/lib/action-policy";
import type { ManagementEnvironment } from "@/lib/server/management-auth";
import { apiCenterAdminJson } from "@/lib/server/api-center-admin";

type ManifestLike = {
  targetEnvironment?: unknown;
  environments?: Array<{ environment?: unknown }>;
};

type RegistrationRequestListResponse = {
  success: boolean;
  data: Array<{
    id: string;
    manifest?: ManifestLike;
  }>;
};

export function stripManagementConfirmationFields<T>(input: T): T {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { confirmation: _confirmation, typedPhrase: _typedPhrase, reason: _reason, ...rest } =
    input as Record<string, unknown>;
  return rest as T;
}
export function resolveRegistryWriteEnvironment(input: unknown): ManagementEnvironment {
  const manifest = readManifest(input);
  if (readRuntimeEnvironment(manifest?.targetEnvironment) === "live") return "live";
  if (manifest?.environments?.some((row) => readRuntimeEnvironment(row.environment) === "live")) {
    return "live";
  }
  return "test";
}

export function registryWriteRiskForEnvironment(environment: ManagementEnvironment): ActionRisk {
  return environment === "live" ? "provider-write" : "state-write";
}

export async function resolveRegistrationRequestEnvironment(
  requestId: string,
): Promise<ManagementEnvironment> {
  const response = await apiCenterAdminJson<RegistrationRequestListResponse>(
    "/api/v1/registry/registration-requests?status=pending",
  );
  const request = response.data.find((item) => item.id === requestId);
  if (!request) {
    return "test";
  }
  return resolveRegistryWriteEnvironment(request.manifest);
}

function readManifest(input: unknown): ManifestLike | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as { manifest?: unknown } & ManifestLike;
  const candidate = record.manifest ?? record;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  return candidate as ManifestLike;
}

function readRuntimeEnvironment(value: unknown): ManagementEnvironment | undefined {
  return value === "live" || value === "test" ? value : undefined;
}
