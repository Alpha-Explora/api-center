import type { Pool } from "pg";
import type { PaymentContext } from "../shared/payment-owner-store";

type ReplayStatus = "running" | "published" | "failed" | "uncertain";
type EventContext = Pick<
  PaymentContext,
  "tribeId" | "projectId" | "consumerServiceId" | "environment"
>;
export class PaymentReplayStore {
  constructor(options?: {
    pool?: Pool;
    publish?: (
      event: Record<string, unknown>,
    ) => Promise<{ published: boolean }>;
  });
  list(
    context: EventContext,
    limit?: number,
  ): Promise<
    Array<{
      id: string;
      eventId: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      aggregateVersion: number;
      status: string;
      publishedAt: string | null;
      attempts: number;
      replayAttemptId: string | null;
      replayStatus: ReplayStatus | null;
      replayCreatedAt: string | null;
      consumerAcknowledgedAt: null;
      lastDeliveryAt: null;
      deadLetterCount: null;
    }>
  >;
  replay(input: {
    eventId: string;
    operationId: string;
    reason: string;
    actor: string;
    context: EventContext;
  }): Promise<{ attemptId: string; status: ReplayStatus }>;
  close(): Promise<void>;
}
