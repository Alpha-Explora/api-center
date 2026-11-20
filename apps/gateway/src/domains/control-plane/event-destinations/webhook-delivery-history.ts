// Reads a webhook destination's delivery attempts from the webhooks runtime, which owns them
// (shared_webhooks.webhook_deliveries). The runtime is reached at WEBHOOK_DELIVERY_URL with a Cloud
// Run identity token and its admin token; the caller has already checked the destination's owner.
import { z } from "zod";
import { BadGatewayError, ServiceUnavailableError } from "@shared/errors";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";

export const webhookDeliverySchema = z.object({
  destinationId: z.string(),
  eventId: z.string(),
  eventType: z.string().nullable(),
  attempt: z.number().int(),
  outcome: z.enum(["delivered", "rejected", "unreachable", "no_active_secret", "disabled"]),
  statusCode: z.number().int().nullable(),
  latencyMs: z.number().int(),
  error: z.string().nullable(),
  attemptedAt: z.string(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export interface WebhookDeliveryHistory {
  list(destinationId: string, limit: number): Promise<WebhookDelivery[]>;
}

export const WEBHOOK_DELIVERY_HISTORY = Symbol("WEBHOOK_DELIVERY_HISTORY");

type FetchLike = (url: string, init: RequestInit) => Promise<globalThis.Response>;

export function createRuntimeDeliveryHistory(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  authorize: (url: string) => Promise<string | undefined> = getCloudRunAuthorizationHeader,
): WebhookDeliveryHistory {
  return {
    async list(destinationId, limit) {
      const base = env.WEBHOOK_DELIVERY_URL?.trim().replace(/\/+$/, "");
      const token = env.WEBHOOKS_ADMIN_TOKEN?.trim();
      if (!base || !token) {
        throw new ServiceUnavailableError("Webhook delivery history is not configured (WEBHOOK_DELIVERY_URL, WEBHOOKS_ADMIN_TOKEN)");
      }
      const headers: Record<string, string> = { "X-APICenter-Webhooks-Admin-Token": token };
      const authorization = await authorize(base);
      if (authorization) headers.Authorization = authorization;
      let response: globalThis.Response;
      try {
        response = await fetchImpl(`${base}/admin/destinations/${encodeURIComponent(destinationId)}/deliveries?limit=${limit}`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new BadGatewayError("The webhooks runtime is unavailable");
      }
      if (!response.ok) throw new BadGatewayError(`The webhooks runtime returned ${response.status}`);
      const parsed = z.object({ deliveries: z.array(webhookDeliverySchema) }).safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new BadGatewayError("The webhooks runtime returned an unexpected delivery history");
      return parsed.data.deliveries;
    },
  };
}
