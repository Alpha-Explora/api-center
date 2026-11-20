// How the audit log reads: grouped by day, with runs of the same change collapsed, and an event's payload as
// "what changed" rather than raw JSON. Pure, so it is tested directly.

import type { AuditEntry } from "./observability";

export interface AuditRow {
  entry: AuditEntry;
  /** Later events that repeat this one (same action, actor, project, environment and outcome), newest first. */
  repeats: AuditEntry[];
}

export interface AuditDay {
  key: string;
  label: string;
  rows: AuditRow[];
}

/**
 * Groups events (newest first) by local day, collapsing consecutive repeats within a day: a smoke test
 * that suspends and restores an environment 24 times reads as two rows, not 48.
 */
export function groupAuditEntries(entries: AuditEntry[], now = Date.now()): AuditDay[] {
  const days: AuditDay[] = [];
  for (const entry of entries) {
    const date = new Date(entry.occurredAt);
    const key = dayKey(date);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, label: dayLabel(date, now), rows: [] };
      days.push(day);
    }
    const last = day.rows[day.rows.length - 1];
    if (last && sameChange(last.entry, entry)) last.repeats.push(entry);
    else day.rows.push({ entry, repeats: [] });
  }
  return days;
}

function sameChange(left: AuditEntry, right: AuditEntry): boolean {
  return (
    left.action === right.action &&
    left.actor === right.actor &&
    left.projectId === right.projectId &&
    left.organizationId === right.organizationId &&
    left.environment === right.environment &&
    left.outcome === right.outcome &&
    left.resourceId === right.resourceId
  );
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", "Wed, 18 Nov", or with the year when it is not this year. */
export function dayLabel(date: Date, now = Date.now()): string {
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const label = `${part("weekday")} ${part("day")} ${part("month")}`;
  return date.getFullYear() === today.getFullYear() ? label : `${label} ${part("year")}`;
}

export interface AuditChange {
  label: string;
  /** The value before the change, when the event recorded one. */
  before?: string;
  after: string;
}

const BEFORE_PREFIXES = ["previous", "old", "from"];

/**
 * An event's payload as label/value lines. A field recorded with its earlier value (role and previousRole,
 * status and oldStatus) reads as one "before → after" line. Nested objects and secrets stay in the raw view.
 */
export function auditChanges(details: Record<string, unknown>): AuditChange[] {
  const keys = Object.keys(details);
  const consumed = new Set<string>();
  const changes: AuditChange[] = [];
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const beforeKey = keys.find((candidate) => BEFORE_PREFIXES.some((prefix) => candidate === `${prefix}${capitalize(key)}` || candidate === `${prefix}_${key}`));
    const after = display(details[key]);
    if (after === undefined) continue;
    if (beforeKey) {
      consumed.add(beforeKey);
      const before = display(details[beforeKey]);
      changes.push({ label: humanize(key), ...(before !== undefined ? { before } : {}), after });
    } else if (!BEFORE_PREFIXES.some((prefix) => key.startsWith(prefix) && keys.includes(uncapitalize(key.slice(prefix.length).replace(/^_/, ""))))) {
      changes.push({ label: humanize(key), after });
    }
  }
  return changes;
}

/** A primitive as text; null reads as "none"; objects, arrays and redacted values are left to the raw view. */
function display(value: unknown): string | undefined {
  if (value === null) return "none";
  if (typeof value === "string") return value === "[redacted]" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** "memberEmail" -> "Member email", "project_id" -> "Project id". */
export function humanize(key: string): string {
  const words = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function uncapitalize(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}
