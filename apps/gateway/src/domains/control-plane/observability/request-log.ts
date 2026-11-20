// The console's request log: redacted per-request diagnostics (apic_runtime.request_diagnostics)
// for one project environment. Rows hold no bodies, query strings, headers or credentials; the
// route is Express's route template, never the requested URL.

import { z } from "zod";
import { ValidationError } from "@shared/errors";

/** request_diagnostics keeps 30 days. */
export const REQUEST_LOG_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export const requestLogQuery = z
  .object({
    applicationId: z
      .string()
      .regex(/^app_[a-z0-9]{24}$/, "must be an app_ identifier")
      .optional(),
    status: z.enum(["2xx", "3xx", "4xx", "5xx"]).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export type RequestLogQuery = z.infer<typeof requestLogQuery>;
export type StatusClass = NonNullable<RequestLogQuery["status"]>;

export function statusRange(status: StatusClass | undefined): [number, number] {
  if (!status) return [100, 599];
  const base = Number(status[0]) * 100;
  return [base, base + 99];
}

/** The time window to read: the last 24 hours by default, never older than retention. */
export function requestLogWindow(query: Pick<RequestLogQuery, "from" | "to">, now: Date): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - DAY_MS);
  const oldest = new Date(now.getTime() - REQUEST_LOG_RETENTION_DAYS * DAY_MS);
  if (from.getTime() >= to.getTime()) throw new ValidationError("from must be before to");
  return { from: from < oldest ? oldest : from, to };
}

export interface RequestLogEntry {
  requestId: string;
  occurredAt: string;
  applicationId: string | null;
  method: string;
  route: string;
  /** The action the request was authorized for; null when it was refused before that, or before it was recorded. */
  action: string | null;
  statusCode: number;
  durationMs: number;
  failureStage: string | null;
  errorCode: string | null;
  correlationId: string;
}

export interface RequestLogRow {
  requestId: string;
  occurredAt: Date;
  applicationId: string | null;
  method: string;
  route: string;
  /** The action the request was authorized for; null when it was refused before that, or before it was recorded. */
  action: string | null;
  statusCode: number;
  durationMs: number;
  failureStage: string | null;
  errorCode: string | null;
  correlationId: string;
}

/** Copies only the reported fields, so a new column never leaks into the console by accident. */
export function toRequestLogEntry(row: RequestLogRow): RequestLogEntry {
  return {
    requestId: row.requestId,
    occurredAt: row.occurredAt.toISOString(),
    applicationId: row.applicationId,
    method: row.method,
    route: row.route,
    action: row.action ?? null,
    statusCode: row.statusCode,
    durationMs: row.durationMs,
    failureStage: row.failureStage,
    errorCode: row.errorCode,
    correlationId: row.correlationId,
  };
}
