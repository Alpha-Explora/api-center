import {
  quotaIncreaseRequestInputSchema,
  quotaIncreaseRequestResponseSchema,
  quotaPolicyDetailResponseSchema,
  quotaPolicyListResponseSchema,
  quotaUsageResponseSchema,
  type QuotaIncreaseRequestInput,
  type QuotaPolicy,
  type QuotaUsageDecision,
  type QuotaUsageWindow,
} from "@/lib/schemas";
import {
  quotaPolicyInputSchema,
  type QuotaPolicyInput,
} from "@/lib/quota-policy";
import { request } from "@/lib/api-center/client-core";

export async function listQuotaPolicies(
  ownerTribeId?: string,
): Promise<QuotaPolicy[]> {
  const params = new URLSearchParams();
  if (ownerTribeId) params.set("ownerTribeId", ownerTribeId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await request<unknown>(`/api/local/quotas/policies${suffix}`);

  return quotaPolicyListResponseSchema.parse(data).data;
}

export async function saveQuotaPolicy(
  input: QuotaPolicyInput,
): Promise<QuotaPolicy> {
  const payload = quotaPolicyInputSchema.parse(input);
  const data = await request<unknown>("/api/local/quotas/policies", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return quotaPolicyDetailResponseSchema.parse(data).data;
}

export async function disableQuotaPolicy(
  policyId: string,
): Promise<QuotaPolicy> {
  const data = await request<unknown>(
    `/api/local/quotas/policies/${encodeURIComponent(policyId)}`,
    { method: "DELETE" },
  );

  return quotaPolicyDetailResponseSchema.parse(data).data;
}

export async function getQuotaUsage(input: {
  ownerTribeId?: string;
  window?: QuotaUsageWindow;
}): Promise<QuotaUsageDecision[]> {
  const params = new URLSearchParams();
  if (input.ownerTribeId) params.set("ownerTribeId", input.ownerTribeId);
  if (input.window) params.set("window", input.window);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await request<unknown>(`/api/local/quotas/usage${suffix}`);

  return quotaUsageResponseSchema.parse(data).data;
}

export async function requestQuotaIncrease(input: QuotaIncreaseRequestInput) {
  const payload = quotaIncreaseRequestInputSchema.parse(input);
  const data = await request<unknown>(
    "/api/local/developer-portal/requests/quota-increase",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  return quotaIncreaseRequestResponseSchema.parse(data).data;
}
