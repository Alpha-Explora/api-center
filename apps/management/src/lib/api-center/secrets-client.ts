import {
  operationPreviewResponseSchema,
  sharedServiceSecretStatusResponseSchema,
  tribeSecretDeleteRequestSchema,
  tribeSecretDeleteResponseSchema,
  tribeSecretProvisionRequestSchema,
  tribeSecretProvisionResponseSchema,
  tribeSecretStatusResponseSchema,
  type OperationPreview,
  type SharedServiceSecretStatusResponse,
  type TribeSecretDeleteRequest,
  type TribeSecretProvisionRequest,
  type TribeSecretProvisionResponse,
} from "@/lib/schemas";
import { request } from "@/lib/api-center/client-core";

export async function provisionTribeSecret(
  input: TribeSecretProvisionRequest,
): Promise<TribeSecretProvisionResponse["data"]> {
  const payload = tribeSecretProvisionRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/tribe-secrets", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return tribeSecretProvisionResponseSchema.parse(data).data;
}

export async function previewTribeSecretProvision(
  input: TribeSecretProvisionRequest,
): Promise<OperationPreview> {
  const payload = tribeSecretProvisionRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/tribe-secrets", {
    method: "POST",
    body: JSON.stringify({ ...payload, preview: true }),
  });

  return operationPreviewResponseSchema.parse(data).preview;
}

export async function getTribeSecretStatus(
  serviceId: string,
  environment: "test" | "live" = "test",
) {
  const params = new URLSearchParams({ environment });
  const data = await request<unknown>(
    `/api/local/tribe-secrets/${encodeURIComponent(serviceId)}?${params.toString()}`,
  );

  return tribeSecretStatusResponseSchema.parse(data).data;
}

export async function getSharedServiceSecretStatus(): Promise<SharedServiceSecretStatusResponse> {
  const data = await request<unknown>("/api/local/secret-status");

  return sharedServiceSecretStatusResponseSchema.parse(data);
}

export async function deleteTribeSecret(
  serviceId: string,
  input: TribeSecretDeleteRequest,
) {
  const payload = tribeSecretDeleteRequestSchema.parse(input);
  const data = await request<unknown>(
    `/api/local/tribe-secrets/${encodeURIComponent(serviceId)}`,
    {
      method: "DELETE",
      body: JSON.stringify(payload),
    },
  );

  return tribeSecretDeleteResponseSchema.parse(data).data;
}

export async function previewTribeSecretDelete(
  serviceId: string,
  input: TribeSecretDeleteRequest,
): Promise<OperationPreview> {
  const payload = tribeSecretDeleteRequestSchema.parse(input);
  const data = await request<unknown>(
    `/api/local/tribe-secrets/${encodeURIComponent(serviceId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ ...payload, preview: true }),
    },
  );

  return operationPreviewResponseSchema.parse(data).preview;
}
