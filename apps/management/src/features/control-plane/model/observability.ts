import { z } from "zod";
import type { Tone } from "@/components/patterns/status-badge";

// ── Request log ──────────────────────────────────────────────────────────────

/** One gateway request made by an application. Bodies, query strings and credentials are never recorded. */
export const requestLogEntrySchema = z.object({
  requestId: z.string(),
  occurredAt: z.string(),
  applicationId: z.string().nullable(),
  method: z.string(),
  /** The route template, not the requested URL. */
  route: z.string(),
  statusCode: z.number(),
  durationMs: z.number(),
  failureStage: z.string().nullable(),
  errorCode: z.string().nullable(),
  correlationId: z.string(),
});
export type RequestLogEntry = z.infer<typeof requestLogEntrySchema>;

export const requestLogPageSchema = z.object({
  from: z.string(),
  to: z.string(),
  items: z.array(requestLogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type RequestLogPage = z.infer<typeof requestLogPageSchema>;

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";
export const STATUS_CLASSES: { value: StatusClass; label: string }[] = [
  { value: "2xx", label: "2xx success" },
  { value: "3xx", label: "3xx redirect" },
  { value: "4xx", label: "4xx client error" },
  { value: "5xx", label: "5xx server error" },
];

/** Request log time ranges; the gateway keeps 30 days. */
export const REQUEST_RANGES = [
  { value: "1h", label: "Last hour", hours: 1 },
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
] as const;
export type RequestRange = (typeof REQUEST_RANGES)[number]["value"];

export type RequestLogFilters = {
  applicationId?: string;
  status?: StatusClass;
  range: RequestRange;
};

/** The gateway's query string for one page of the request log. `now` is fixed per filter change so pages line up. */
export function requestLogSearch(filters: RequestLogFilters, now: number, cursor?: string): string {
  const hours = REQUEST_RANGES.find((range) => range.value === filters.range)?.hours ?? 24;
  const params = new URLSearchParams({
    from: new Date(now - hours * 3_600_000).toISOString(),
    to: new Date(now).toISOString(),
    limit: "50",
  });
  if (filters.applicationId) params.set("applicationId", filters.applicationId);
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function statusCodeTone(statusCode: number): Tone {
  if (statusCode >= 500) return "danger";
  if (statusCode >= 400) return "warning";
  if (statusCode >= 300) return "info";
  return "success";
}

const FAILURE_STAGES: Record<string, string> = {
  authentication: "Authentication: the key or token was missing, invalid or revoked.",
  authorization: "Authorization: the application has no grant for this action, or the environment refused it.",
  quota: "Quota: a request budget was full.",
  routing: "Routing: the gateway had nowhere to send the request.",
  runtime: "Runtime: the shared service failed.",
  provider: "Provider: the upstream provider failed.",
  unknown: "The gateway could not tell where the request failed.",
};

export function describeFailureStage(stage: string | null): string | undefined {
  return stage ? (FAILURE_STAGES[stage] ?? stage) : undefined;
}

/** "84 ms", "1.2 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

// ── Usage over time ──────────────────────────────────────────────────────────

export type UsageRange = "24h" | "7d" | "30d";
export const USAGE_RANGES: { value: UsageRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export const usageSeriesSchema = z.object({
  range: z.enum(["24h", "7d", "30d"]),
  bucket: z.enum(["hour", "day"]),
  from: z.string(),
  to: z.string(),
  totals: z.object({ requests: z.number(), failed: z.number() }),
  series: z.array(z.object({ start: z.string(), requests: z.number(), failed: z.number() })),
  byApplication: z.array(
    z.object({
      applicationId: z.string(),
      requests: z.number(),
      failed: z.number(),
      series: z.array(z.number()),
    }),
  ),
  byAction: z.array(
    z.object({
      capability: z.string(),
      action: z.string(),
      requests: z.number(),
      failed: z.number(),
    }),
  ),
});
export type UsageSeries = z.infer<typeof usageSeriesSchema>;

/** The smallest "round" axis maximum at or above the largest value: 1, 2, 5, 10, 20, 50… */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

/** A bucket's label on the chart's axis: "14:00" for hours, "Nov 20" for days, in UTC like the buckets. */
export function bucketLabel(start: string, bucket: "hour" | "day"): string {
  const date = new Date(start);
  return bucket === "hour"
    ? `${String(date.getUTCHours()).padStart(2, "0")}:00`
    : date.toLocaleDateString("en", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
}

// ── Quota meters ─────────────────────────────────────────────────────────────

export const quotaMeterSchema = z.object({
  budgetKey: z.string(),
  source: z.enum(["plan", "test-default", "project-policy", "shared-ceiling"]),
  policyId: z.string().nullable(),
  capability: z.string().nullable(),
  mode: z.enum(["observe", "enforce"]),
  windowSeconds: z.number(),
  /** null when the plan is unlimited. */
  limit: z.number().nullable(),
  /** null when nothing counts toward it: a disabled policy, or an unlimited plan. */
  used: z.number().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
});
export type QuotaMeter = z.infer<typeof quotaMeterSchema>;

export const quotaMetersSchema = z.object({
  generatedAt: z.string(),
  planKey: z.string().nullable(),
  baseBudget: z.enum(["plan", "test-default", "unlimited", "live-plan-required", "plan-not-available"]),
  meters: z.array(quotaMeterSchema),
});
export type QuotaMeters = z.infer<typeof quotaMetersSchema>;

export const sharedCeilingMetersSchema = z.object({
  generatedAt: z.string(),
  meters: z.array(quotaMeterSchema),
});

/** The plan's (or test default's) daily budget, when one applies. */
export function baseMeter(meters: QuotaMeters | undefined): QuotaMeter | undefined {
  return meters?.meters.find((meter) => meter.source === "plan" || meter.source === "test-default");
}

/** How full a meter is, 0–100, and how that reads: over 80% warns, a full enforced budget is a failure. */
export function meterLevel(meter: Pick<QuotaMeter, "used" | "limit" | "mode">): { percent: number; tone: Tone } | undefined {
  if (meter.used === null || meter.limit === null || meter.limit <= 0) return undefined;
  const percent = Math.min(100, (meter.used / meter.limit) * 100);
  if (meter.used >= meter.limit) return { percent, tone: meter.mode === "enforce" ? "danger" : "warning" };
  return { percent, tone: percent >= 80 ? "warning" : "success" };
}

// ── Audit log ────────────────────────────────────────────────────────────────

export const auditEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  organizationId: z.string().nullable(),
  projectId: z.string().nullable(),
  environment: z.enum(["test", "live"]).nullable(),
  actor: z.string().nullable(),
  actorType: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  outcome: z.string(),
  message: z.string().nullable(),
  correlationId: z.string().nullable(),
  /** The event's payload with secret fields replaced by "[redacted]". */
  details: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;

/** Action families the audit log filters by: `control_plane.<type>.*`. */
export const AUDIT_ACTION_TYPES: { value: string; label: string }[] = [
  { value: "control_plane.project", label: "Projects" },
  { value: "control_plane.environment", label: "Environment status" },
  { value: "control_plane.live", label: "Going live" },
  { value: "control_plane.plan", label: "Plans" },
  { value: "control_plane.capability", label: "Capabilities" },
  { value: "control_plane.capability_config", label: "Capability settings" },
  { value: "control_plane.application", label: "Applications" },
  { value: "control_plane.grant", label: "Grants" },
  { value: "control_plane.credential", label: "Keys" },
  { value: "control_plane.api", label: "Published APIs" },
  { value: "control_plane.api_access", label: "API access" },
  { value: "control_plane.event_destination", label: "Webhooks" },
  { value: "control_plane.quota", label: "Quotas" },
  { value: "control_plane.member", label: "Members" },
  { value: "control_plane.team", label: "Teams" },
  { value: "control_plane.project_role", label: "Project roles" },
];

export const AUDIT_RANGES = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
  { value: "all", label: "All time", hours: null },
] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number]["value"];

export type AuditFilters = {
  projectId?: string;
  actor?: string;
  action?: string;
  range: AuditRange;
};

export function auditSearch(filters: AuditFilters, now: number, cursor?: string, limit = 50): string {
  const params = new URLSearchParams({ limit: String(limit) });
  const hours = AUDIT_RANGES.find((range) => range.value === filters.range)?.hours ?? null;
  if (hours !== null) params.set("from", new Date(now - hours * 3_600_000).toISOString());
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.actor?.trim()) params.set("actor", filters.actor.trim().toLowerCase());
  if (filters.action) params.set("action", filters.action);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/** "control_plane.credential.revoked" → "Key revoked"; "control_plane.api_access.granted" → "API access granted". */
export function auditActionLabel(action: string): string {
  if (action === "control_plane.member.set") return "Member role set";
  const parts = action.split(".");
  const [type, ...rest] = parts[0] === "control_plane" ? parts.slice(1) : parts;
  if (!type) return action;
  const noun = AUDIT_NOUNS[type] ?? type.replaceAll("_", " ");
  const verb = rest.map((word) => AUDIT_VERBS[word] ?? word.replaceAll("_", " ")).join(" ");
  const text = verb ? `${noun} ${verb}` : noun;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** HTTP-method verbs some writers record. */
const AUDIT_VERBS: Record<string, string> = { put: "updated", delete: "removed" };

const AUDIT_NOUNS: Record<string, string> = {
  api: "API",
  api_access: "API access",
  capability_config: "capability settings",
  credential: "key",
  event_destination: "webhook",
  live: "live",
  project_role: "project role",
  quota: "quota policy",
};
