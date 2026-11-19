// The console's audit log: control-plane audit events (apic_audit.audit_events) for one
// organization, or for the whole platform. Pure query building and redaction.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ValidationError } from "@shared/errors";
import type { AuditScope } from "../console-access.policy";
import type { Cursor } from "./cursor";

export const auditLogQuery = z
  .object({
    projectId: z
      .string()
      .regex(/^prj_[a-z0-9]{24}$/, "must be a prj_ identifier")
      .optional(),
    actor: z.string().trim().min(1).max(320).optional(),
    /** An action or action prefix, e.g. `control_plane.credential` or `control_plane.credential.revoked`. */
    action: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)*$/, "must be an action such as control_plane.credential")
      .max(100)
      .optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export const platformAuditLogQuery = auditLogQuery.extend({ organizationId: z.string().uuid().optional() }).strict();

export type AuditLogQuery = z.infer<typeof auditLogQuery>;

export function auditLogWhere(
  query: AuditLogQuery & { organizationId?: string },
  scope: AuditScope,
  cursor: Cursor | undefined,
): Prisma.AuditEventWhereInput {
  if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) throw new ValidationError("from must be before to");
  const conditions: Prisma.AuditEventWhereInput[] = [];
  if (query.organizationId) conditions.push({ organizationId: query.organizationId });
  if (scope.kind === "projects") conditions.push({ projectId: { in: scope.projectIds } });
  if (query.projectId) conditions.push({ projectId: query.projectId });
  if (query.actor) conditions.push({ actorId: query.actor });
  if (query.action) conditions.push({ OR: [{ action: query.action }, { action: { startsWith: `${query.action}.` } }] });
  if (query.from) conditions.push({ createdAt: { gte: new Date(query.from) } });
  if (query.to) conditions.push({ createdAt: { lte: new Date(query.to) } });
  if (cursor) conditions.push({ OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] });
  return { AND: conditions };
}

const SECRET_KEY = /secret|password|passphrase|token|signing|private|authorization|cookie|api_?key|credential(?!id)|plaintext/i;
const SECRET_VALUE = [/^whsec_/, /^ak_(test|live)_[a-z0-9]{16}_[A-Za-z0-9_-]{43}$/, /^Bearer\s/i, /^-----BEGIN [A-Z ]*PRIVATE KEY-----/];
/** Timestamps about secrets (`secretRotatedAt`) are not secrets. */
const TIMESTAMP_KEY = /At$/;
const REDACTED = "[redacted]";

/** Drops secret-looking fields and values from an event payload, at any depth. */
export function redactAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === "string") return SECRET_VALUE.some((pattern) => pattern.test(value)) ? REDACTED : value.slice(0, 2_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactAuditDetails(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SECRET_KEY.test(key) && !TIMESTAMP_KEY.test(key) ? REDACTED : redactAuditDetails(entry, depth + 1),
      ]),
    );
  }
  return value;
}

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  organizationId: string | null;
  projectId: string | null;
  environment: string | null;
  actor: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  message: string | null;
  correlationId: string | null;
  details: Record<string, unknown>;
}

export interface AuditEventRow {
  id: string;
  createdAt: Date;
  organizationId: string | null;
  projectId: string | null;
  environment: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  correlationId: string | null;
  metadata: unknown;
}

export function toAuditLogEntry(row: AuditEventRow): AuditLogEntry {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const details = redactAuditDetails(metadata.payload ?? {});
  return {
    id: row.id,
    occurredAt: row.createdAt.toISOString(),
    organizationId: row.organizationId,
    projectId: row.projectId,
    environment: row.environment === "test" || row.environment === "live" ? row.environment : null,
    actor: row.actorId,
    actorType: row.actorType,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: row.outcome,
    message: typeof metadata.message === "string" ? metadata.message.slice(0, 500) : null,
    correlationId: row.correlationId,
    details: details && typeof details === "object" && !Array.isArray(details) ? (details as Record<string, unknown>) : {},
  };
}
