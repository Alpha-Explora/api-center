import { z } from "zod";
import { environmentKindSchema, grantSchema, type Me } from "./control-plane";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The gateway's limits on a published API (control-plane-admin.controller.ts, published-api.service.ts). */
export const MAX_OPERATIONS = 200;
export const MAX_DESCRIPTION = 300;
export const MAX_PATH = 300;
export const MAX_ACTION = 64;

const operationSchema = z.object({
  method: z.string(),
  path: z.string(),
  action: z.string(),
  description: z.string().nullable().optional(),
});

export const publishedApiSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  environmentKind: environmentKindSchema,
  slug: z.string(),
  name: z.string(),
  upstreamUrl: z.string(),
  status: z.string(),
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  operations: z.array(operationSchema),
});

/** A row of the organization's API catalogue: active APIs only, without upstream URLs. */
export const catalogApiSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  slug: z.string(),
  name: z.string(),
  environmentKind: environmentKindSchema,
  operations: z.array(operationSchema),
});

export const accessRequestSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  action: z.string(),
  consumerProjectId: z.string(),
  consumerEnvironmentId: z.string(),
  consumerApplicationId: z.string(),
  status: z.string(),
  requestedBy: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  grantId: z.string().nullable(),
  createdAt: z.string(),
});

/** POST api-grants: granted at once in the API's own project, otherwise a request its admins decide. */
export const apiGrantOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("granted"), grant: grantSchema }),
  z.object({ kind: z.literal("requested"), request: accessRequestSchema }),
]);

export type PublishedApi = z.infer<typeof publishedApiSchema>;
export type CatalogApi = z.infer<typeof catalogApiSchema>;
export type AccessRequest = z.infer<typeof accessRequestSchema>;
export type ApiGrantOutcome = z.infer<typeof apiGrantOutcomeSchema>;

// ── Operations editor ───────────────────────────────────────────────────

/** One editable row. `key` only keeps React rows stable while editing. */
export type OperationDraft = { key: string; method: HttpMethod; path: string; action: string; description: string };
export type OperationBody = { method: HttpMethod; path: string; action: string; description?: string };
export type OperationErrors = Partial<Record<"method" | "path" | "action" | "description", string>>;

const SEGMENT = /^([A-Za-z0-9._~-]+|\{[A-Za-z][A-Za-z0-9_]*\})$/;
export const ACTION_PATTERN = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$/;

/** "/" or literal segments and `{name}` placeholders; mirrors the gateway's api-operations.ts. */
export function isValidOperationPath(path: string): boolean {
  if (path === "/") return true;
  if (!path.startsWith("/")) return false;
  const segments = path.replace(/\/$/, "").split("/").slice(1);
  return segments.length > 0 && segments.every((segment) => SEGMENT.test(segment) && !/^\.+$/.test(segment));
}

/** Why a path pattern is invalid, naming the offending part; undefined when it is valid. */
export function operationPathError(path: string): string | undefined {
  if (isValidOperationPath(path)) return undefined;
  if (!path.startsWith("/")) return "Start the path with /.";
  const segments = path.replace(/\/$/, "").split("/").slice(1);
  if (segments.some((segment) => segment === "")) return "Remove the empty segment (//).";
  if (segments.some((segment) => /^\.+$/.test(segment))) return "Segments of only dots are not allowed.";
  const placeholder = segments.find((segment) => (segment.includes("{") || segment.includes("}")) && !SEGMENT.test(segment));
  if (placeholder) return `${placeholder} is not a placeholder. Use a whole segment like {orderId}: a letter, then letters, digits or _.`;
  return "Use letters, digits, . _ ~ - in path segments, and {name} placeholders.";
}

export function operationKey(operation: { method: string; path: string }) {
  return `${operation.method.toUpperCase()} ${operation.path.trim()}`;
}

/** Per-row errors (index → field → message) plus one form-level error; empty when the rows can be sent. */
export function validateOperations(rows: Pick<OperationDraft, "method" | "path" | "action" | "description">[]): {
  rows: Record<number, OperationErrors>;
  form?: string;
} {
  const errors: Record<number, OperationErrors> = {};
  const firstIndex = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowErrors: OperationErrors = {};
    const path = row.path.trim();
    const action = row.action.trim();
    if (!HTTP_METHODS.includes(row.method)) rowErrors.method = "Choose GET, POST, PUT, PATCH or DELETE.";
    if (!path) rowErrors.path = "Enter a path.";
    else if (path.length > MAX_PATH) rowErrors.path = `At most ${MAX_PATH} characters.`;
    else if (!isValidOperationPath(path)) rowErrors.path = operationPathError(path);
    if (!action) rowErrors.action = "Enter an action.";
    else if (action.length > MAX_ACTION) rowErrors.action = `At most ${MAX_ACTION} characters.`;
    else if (!ACTION_PATTERN.test(action)) rowErrors.action = "Use lowercase words separated by colons, like orders:read.";
    if (row.description.trim().length > MAX_DESCRIPTION) rowErrors.description = `At most ${MAX_DESCRIPTION} characters.`;
    if (path && !rowErrors.path) {
      const key = operationKey({ method: row.method, path });
      const first = firstIndex.get(key);
      if (first === undefined) firstIndex.set(key, index);
      else rowErrors.path = `${key} is already declared in row ${first + 1}.`;
    }
    if (Object.keys(rowErrors).length > 0) errors[index] = rowErrors;
  });
  const form =
    rows.length === 0 ? "Add at least one operation." : rows.length > MAX_OPERATIONS ? `An API can declare at most ${MAX_OPERATIONS} operations.` : undefined;
  return form ? { rows: errors, form } : { rows: errors };
}

export function hasOperationErrors(result: ReturnType<typeof validateOperations>) {
  return Boolean(result.form) || Object.keys(result.rows).length > 0;
}

/** The request body for the rows; the gateway rejects unknown keys, so an empty description is left out. */
export function toOperationsBody(rows: Pick<OperationDraft, "method" | "path" | "action" | "description">[]): OperationBody[] {
  return rows.map((row) => {
    const description = row.description.trim();
    return { method: row.method, path: row.path.trim(), action: row.action.trim(), ...(description ? { description } : {}) };
  });
}

let draftCounter = 0;
export function newOperationDraft(partial: Partial<Omit<OperationDraft, "key">> = {}): OperationDraft {
  draftCounter += 1;
  return { key: `op-${draftCounter}`, method: "GET", path: "", action: "", description: "", ...partial };
}

export function draftsFrom(operations: PublishedApi["operations"]): OperationDraft[] {
  return operations.map((operation) =>
    newOperationDraft({
      method: (HTTP_METHODS as readonly string[]).includes(operation.method) ? (operation.method as HttpMethod) : "GET",
      path: operation.path,
      action: operation.action,
      description: operation.description ?? "",
    }),
  );
}

/** Whether saving the rows would change the API's operations (order is not significant to the gateway). */
export function operationsChanged(current: PublishedApi["operations"], rows: Pick<OperationDraft, "method" | "path" | "action" | "description">[]) {
  const canonical = (list: { method: string; path: string; action: string; description?: string | null }[]) =>
    list
      .map((entry) => `${operationKey(entry)}|${entry.action.trim()}|${(entry.description ?? "").trim()}`)
      .sort()
      .join("\n");
  return canonical(current) !== canonical(rows);
}

/** Distinct actions an API declares, in first-seen order. */
export function apiActions(api: { operations: { action: string }[] }): string[] {
  return [...new Set(api.operations.map((operation) => operation.action))];
}

// ── Upstream URL ────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

function isPrivateIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(host: string) {
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice(7);
    // URL() normalizes ::ffff:10.0.0.1 to ::ffff:a00:1; read the hex form back as IPv4.
    const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return isPrivateIpv4(mapped);
  }
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(host) || host.startsWith("64:ff9b:") || host.startsWith("2001:db8:");
}

/**
 * The upstream URL's shape, mirroring the gateway's upstream guard. The gateway also resolves the host and
 * rejects private addresses (400 UPSTREAM_NOT_ALLOWED), which the console cannot check.
 */
export function upstreamUrlError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return "Enter the upstream URL.";
  if (value.length < 8 || value.length > 2048) return "Use 8 to 2048 characters.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL, like https://orders.example.com.";
  }
  if (url.protocol !== "https:") return "The upstream must use https.";
  if (url.username || url.password) return "Leave credentials out of the URL.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".internal") || host.endsWith(".local")) return "The upstream host must be public.";
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return "The upstream address must be publicly routable.";
  return undefined;
}

/** The host shown for an upstream in lists; the raw value when it is not a URL. */
export function upstreamHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ── Access requests ─────────────────────────────────────────────────────

/** The label the gateway records as `requestedBy`/`decidedBy` for this person (console-actor.guard.ts actorLabel). */
export function actorLabelOf(me: Me | undefined): string | undefined {
  if (!me) return undefined;
  if (me.actor.kind === "member") return me.actor.email;
  return "platform";
}

/** Pending first (oldest first, so the longest-waiting is on top), then decided ones, newest decision first. */
export function sortAccessRequests(requests: AccessRequest[]) {
  const pending = requests.filter((request) => request.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const decided = requests
    .filter((request) => request.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
  return { pending, decided };
}

// ── Catalogue ───────────────────────────────────────────────────────────

/** Case-insensitive match on the API's name, slug, project name, or any operation's method, path or action. */
export function catalogMatches(api: CatalogApi, query: string, projectName?: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [api.name, api.slug, api.id, projectName ?? "", ...api.operations.flatMap((operation) => [operation.method, operation.path, operation.action, operation.description ?? ""])]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
