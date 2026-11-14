import { request } from "@/lib/api-center/client-core";
import { goLiveSchema } from "../model/go-live";

export async function loadGoLive(
  serviceId: string,
  environment: "test" | "live",
) {
  const response = await request<{ data: unknown }>(
    `/api/local/services/${encodeURIComponent(serviceId)}/go-live?environment=${environment}`,
  );
  return goLiveSchema.parse(response.data);
}

export async function revokePaymentKey(input: {
  serviceId: string;
  environment: "test" | "live";
  keyId: string;
  typedPhrase: string;
  reason: string;
}) {
  return request(
    `/api/local/payment-consumers/${encodeURIComponent(input.serviceId)}/revoke-key`,
    {
      method: "POST",
      body: JSON.stringify({
        environment: input.environment,
        keyId: input.keyId,
        confirmation: { typedPhrase: input.typedPhrase, reason: input.reason },
      }),
    },
  );
}

export function requestVerification(input: {
  serviceId: string;
  environment: "test" | "live";
  typedPhrase: string;
  reason: string;
}) {
  return request(
    `/api/local/services/${encodeURIComponent(input.serviceId)}/verification`,
    {
      method: "POST",
      body: JSON.stringify({
        environment: input.environment,
        confirmation: { typedPhrase: input.typedPhrase, reason: input.reason },
      }),
    },
  );
}
