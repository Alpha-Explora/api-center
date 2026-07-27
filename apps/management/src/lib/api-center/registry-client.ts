import {
  registryDetailResponseSchema,
  registryListResponseSchema,
  registrationRequestDetailResponseSchema,
  registrationRequestListResponseSchema,
  serviceHealthResultSchema,
  serviceManifestSchema,
  type RegistrationRequestStatus,
  type ServiceHealthResult,
  type ServiceManifest,
  type ServiceRegistryEntry,
  type ServiceRegistrationRequest,
} from "@/lib/schemas";
import { request } from "@/lib/api-center/client-core";

export async function listServices(): Promise<ServiceRegistryEntry[]> {
  const data = await request<unknown>("/api/local/registry/services");
  return registryListResponseSchema.parse(data).data;
}

export async function getService(
  serviceId: string,
): Promise<ServiceRegistryEntry> {
  const data = await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}`,
  );
  return registryDetailResponseSchema.parse(data).data;
}

export async function registerService(
  input: ServiceManifest,
): Promise<ServiceRegistryEntry> {
  const manifest = serviceManifestSchema.parse(input);
  const data = await request<unknown>("/api/local/registry/register", {
    method: "POST",
    body: JSON.stringify(manifest),
  });

  return registryDetailResponseSchema.parse(data).data;
}

export async function createRegistrationRequest(input: {
  manifest: ServiceManifest;
  requestedBy?: string;
}): Promise<ServiceRegistrationRequest> {
  const payload = {
    ...input,
    manifest: serviceManifestSchema.parse(input.manifest),
  };
  const data = await request<unknown>(
    "/api/local/registry/registration-requests",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return registrationRequestDetailResponseSchema.parse(data).data;
}

export async function listRegistrationRequests(
  status: RegistrationRequestStatus = "pending",
): Promise<ServiceRegistrationRequest[]> {
  const data = await request<unknown>(
    `/api/local/registry/registration-requests?status=${encodeURIComponent(status)}`,
  );

  return registrationRequestListResponseSchema.parse(data).data;
}

export type RegistrationApprovalConfirmation = {
  typedPhrase: string;
  reason: string;
};

export async function approveRegistrationRequest(
  requestId: string,
  confirmation?: RegistrationApprovalConfirmation,
): Promise<ServiceRegistrationRequest> {
  const data = await request<unknown>(
    `/api/local/registry/registration-requests/${encodeURIComponent(requestId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify(confirmation ? { confirmation } : {}),
    },
  );

  return registrationRequestDetailResponseSchema.parse(data).data;
}

export async function rejectRegistrationRequest(
  requestId: string,
  reason: string,
): Promise<ServiceRegistrationRequest> {
  const data = await request<unknown>(
    `/api/local/registry/registration-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );

  return registrationRequestDetailResponseSchema.parse(data).data;
}

export async function activateService(
  serviceId: string,
): Promise<ServiceRegistryEntry> {
  const data = await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}/activate`,
    { method: "PATCH" },
  );
  return registryDetailResponseSchema.parse(data).data;
}

export async function deprecateService(
  serviceId: string,
  input: { sunsetDate?: string; replacementService?: string },
): Promise<ServiceRegistryEntry> {
  const data = await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}/deprecate`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return registryDetailResponseSchema.parse(data).data;
}

export async function retireService(
  serviceId: string,
): Promise<ServiceRegistryEntry> {
  const data = await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}/retire`,
    { method: "POST" },
  );
  return registryDetailResponseSchema.parse(data).data;
}

export async function deregisterService(serviceId: string) {
  await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}`,
    { method: "DELETE" },
  );
}

export async function checkServiceHealth(
  serviceId: string,
): Promise<ServiceHealthResult> {
  const data = await request<unknown>(
    `/api/local/registry/services/${encodeURIComponent(serviceId)}/health`,
    { method: "POST" },
  );
  return serviceHealthResultSchema.parse(data);
}
