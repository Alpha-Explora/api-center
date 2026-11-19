import { z } from "zod";
import { request } from "@/lib/api-center/client-core";

const records = z.object({
  data: z.array(
    z.object({
      requestId: z.string(),
      correlationId: z.string(),
      serviceId: z.string().nullable(),
      environment: z.string().nullable(),
      route: z.string(),
      method: z.string(),
      statusCode: z.number(),
      errorCode: z.string().nullable(),
      paymentResourceId: z.string().nullable(),
      failureStage: z.string().nullable(),
      durationMs: z.number(),
      occurredAt: z.string(),
    }),
  ),
});

/** Unattributed requests with this correlation ID in the last 24 hours (platform operators only). */
export async function loadRequests(correlationId: string) {
  const query = new URLSearchParams({ correlationId: correlationId.trim() });
  const result = await request<unknown>(`/api/local/request-diagnostics?${query}`);
  return records.parse(result).data;
}
