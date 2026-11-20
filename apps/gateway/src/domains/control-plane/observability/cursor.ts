// Opaque keyset cursors for newest-first lists: the last row's time and ID.
//
// The time travels as text, not a JS Date: request_diagnostics.created_at keeps microseconds and a
// Date keeps milliseconds, so a Date cursor would sort before rows that share its millisecond and
// skip them on the next page. Readers that compare in SQL cast `at` back with ::timestamptz.

import { ValidationError } from "@shared/errors";

export interface Cursor {
  /** ISO-8601 UTC timestamp with up to microsecond precision, e.g. 2026-11-20T10:00:00.123456Z. */
  at: string;
  /** The row's UUID; both paginated lists (request diagnostics, audit events) key on one. */
  id: string;
}

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === "string" && typeof decoded[1] === "string") {
      const [at, id] = decoded;
      if (AT.test(at) && !Number.isNaN(Date.parse(at)) && UUID.test(id)) return { at, id };
    }
  } catch {
    // Reported below.
  }
  throw new ValidationError("cursor is invalid; start again from the first page");
}

/** Splits a page fetched with `limit + 1` rows into the page and the next cursor. */
export function pageOf<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}
