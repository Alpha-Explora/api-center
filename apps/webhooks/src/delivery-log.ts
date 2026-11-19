// Delivery history: one record per attempt this service makes for a destination, so the console can
// show what the consumer's endpoint answered. Kept in this runtime's own schema (shared_webhooks),
// append-only, never the event body. Recording is best effort: a failed write is logged and never
// changes whether Pub/Sub retries the event.
import { Pool } from "pg";
import type { DeliveryOutcome } from "./delivery";

export type RecordedOutcome = "delivered" | "rejected" | "unreachable" | "no_active_secret" | "disabled";

export interface DeliveryAttempt {
  destinationId: string;
  eventId: string;
  eventType: string | null;
  attempt: number;
  outcome: RecordedOutcome;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  attemptedAt: string;
}

export interface DeliveryLog {
  record(attempt: DeliveryAttempt): Promise<void>;
  /** Newest first. */
  list(destinationId: string, limit: number): Promise<DeliveryAttempt[]>;
}

export const MAX_LISTED_ATTEMPTS = 100;

const RECORDED = new Set<string>(["delivered", "rejected", "unreachable", "no_active_secret", "disabled"]);

/**
 * The attempt to record for an outcome, or null when nothing reached a known destination
 * (an unknown destination or an event without an ID has no history to attach to).
 */
export function attemptFor(
  destinationId: string,
  outcome: DeliveryOutcome,
  details: { attempt: number; latencyMs: number; at: Date },
): DeliveryAttempt | null {
  if (!RECORDED.has(outcome.reason) || !outcome.eventId) return null;
  return {
    destinationId,
    eventId: outcome.eventId.slice(0, 200),
    eventType: outcome.eventType?.slice(0, 200) ?? null,
    attempt: Math.max(1, Math.floor(details.attempt) || 1),
    outcome: outcome.reason as RecordedOutcome,
    statusCode: outcome.status !== undefined && outcome.status >= 100 && outcome.status <= 599 ? outcome.status : null,
    latencyMs: Math.max(0, Math.round(details.latencyMs)),
    error: "error" in outcome && outcome.error ? outcome.error.slice(0, 500) : null,
    attemptedAt: details.at.toISOString(),
  };
}

export function createMemoryDeliveryLog(): DeliveryLog & { attempts: DeliveryAttempt[] } {
  const attempts: DeliveryAttempt[] = [];
  return {
    attempts,
    async record(attempt) {
      attempts.push(attempt);
    },
    async list(destinationId, limit) {
      return attempts
        .filter((attempt) => attempt.destinationId === destinationId)
        .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))
        .slice(0, limit);
    },
  };
}

type Row = {
  destination_id: string;
  event_id: string;
  event_type: string | null;
  attempt: number;
  outcome: RecordedOutcome;
  status_code: number | null;
  latency_ms: number;
  error: string | null;
  attempted_at: Date;
};

export function createPostgresDeliveryLog(connectionString: string): DeliveryLog {
  const pool = new Pool({
    connectionString,
    max: 4,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("error", () => undefined);
  return {
    async record(attempt) {
      await pool.query(
        `INSERT INTO shared_webhooks.webhook_deliveries
           (destination_id, event_id, event_type, attempt, outcome, status_code, latency_ms, error, attempted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          attempt.destinationId,
          attempt.eventId,
          attempt.eventType,
          attempt.attempt,
          attempt.outcome,
          attempt.statusCode,
          attempt.latencyMs,
          attempt.error,
          attempt.attemptedAt,
        ],
      );
    },
    async list(destinationId, limit) {
      const result = await pool.query<Row>(
        `SELECT destination_id, event_id, event_type, attempt, outcome, status_code, latency_ms, error, attempted_at
         FROM shared_webhooks.webhook_deliveries
         WHERE destination_id = $1
         ORDER BY attempted_at DESC
         LIMIT $2`,
        [destinationId, limit],
      );
      return result.rows.map((row) => ({
        destinationId: row.destination_id,
        eventId: row.event_id,
        eventType: row.event_type,
        attempt: row.attempt,
        outcome: row.outcome,
        statusCode: row.status_code,
        latencyMs: row.latency_ms,
        error: row.error,
        attemptedAt: row.attempted_at.toISOString(),
      }));
    },
  };
}

/** Postgres when DATABASE_URL is set. Production refuses to start without it; elsewhere history is kept in memory. */
export function createDeliveryLog(env: NodeJS.ProcessEnv = process.env): DeliveryLog {
  if (env.DATABASE_URL) return createPostgresDeliveryLog(env.DATABASE_URL);
  if (env.NODE_ENV === "production") throw new Error("DATABASE_URL is required for the webhook delivery history in production");
  return createMemoryDeliveryLog();
}
