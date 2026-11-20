// Keyset pages for console lists that grow without bound (projects, members, keys). A page is
// `limit` rows in a fixed order; `meta.nextCursor` names the last row, and passing it back as
// `cursor` continues after it. `data` stays the array it always was, so callers that read only
// the first page keep working.

import { ValidationError } from "@shared/errors";

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export interface PageQuery {
  limit: number;
  /** The sort key of the row the previous page ended on. */
  after?: string[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Reads `limit` (1–200, default 100) and an opaque `cursor` with `arity` key parts. */
export function parsePageQuery(query: unknown, arity: number): PageQuery {
  const fields = query && typeof query === "object" ? (query as Record<string, unknown>) : {};
  const rawLimit = fields.limit;
  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}`);
    }
  }
  if (fields.cursor === undefined || fields.cursor === "") return { limit };
  return { limit, after: decodeKey(String(fields.cursor), arity) };
}

export function encodeKey(values: string[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

function decodeKey(value: string, arity: number): string[] {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(decoded) && decoded.length === arity && decoded.every((part) => typeof part === "string" && part.length <= 320)) {
      return decoded as string[];
    }
  } catch {
    // Reported below.
  }
  throw new ValidationError("cursor is invalid; start again from the first page");
}

/** Cuts the `limit + 1` rows a query fetched into a page and the cursor for the next one. */
export function pageFrom<T>(rows: T[], limit: number, keyOf: (row: T) => string[]): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeKey(keyOf(last)) : null };
}

/** Rows after `(createdAt, id)` in ascending order, for `orderBy: [{ createdAt: "asc" }, { id: "asc" }]`. */
export function afterCreatedAt(after: string[] | undefined): Record<string, unknown> {
  if (!after) return {};
  const [at, id] = after;
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime())) throw new ValidationError("cursor is invalid; start again from the first page");
  return { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: id } }] };
}
