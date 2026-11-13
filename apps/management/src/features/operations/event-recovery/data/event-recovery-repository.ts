import { z } from "zod";
import { request } from "@/lib/api-center/client-core";
const events = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      eventId: z.string(),
      eventType: z.string(),
      aggregateId: z.string(),
      aggregateVersion: z.number(),
      status: z.string(),
      replayStatus: z.string().nullable(),
      publishedAt: z.string().nullable(),
    }),
  ),
});
export async function loadEvents(
  serviceId: string,
  environment: "test" | "live",
) {
  return events.parse(
    await request<unknown>(
      `/api/local/services/${encodeURIComponent(serviceId)}/events?environment=${environment}`,
    ),
  ).data;
}
export async function replayEvent(input: {
  serviceId: string;
  environment: "test" | "live";
  eventId: string;
  operationId: string;
  reason: string;
  typedPhrase: string;
}) {
  const result = await request<unknown>(
    `/api/local/services/${encodeURIComponent(input.serviceId)}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        environment: input.environment,
        eventId: input.eventId,
        operationId: input.operationId,
        reason: input.reason,
        confirmation: { reason: input.reason, typedPhrase: input.typedPhrase },
      }),
    },
  );
  return z
    .object({
      data: z.object({
        attemptId: z.string().uuid(),
        status: z.enum(["running", "published", "failed", "uncertain"]),
      }),
    })
    .parse(result).data;
}
