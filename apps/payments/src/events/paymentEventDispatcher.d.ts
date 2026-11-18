import type { Pool } from "pg";

export function createPaymentEventPool(connectionString?: string): Pool;

/** Claim and publish one bounded batch. A provided pool is reused and left open. */
export function drainPaymentEventOutbox(options?: {
  limit?: number;
  logger?: Pick<Console, "log" | "error">;
  pool?: Pool;
  publish?: (event: Record<string, unknown>) => Promise<{ published?: boolean; disabled?: boolean; messageId?: string }>;
}): Promise<{ claimed: number; published: number; failed: number }>;
