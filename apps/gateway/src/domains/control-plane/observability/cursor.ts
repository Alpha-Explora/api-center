// Opaque keyset cursors for newest-first lists: the last row's time and ID.

import { ValidationError } from "@shared/errors";

export interface Cursor {
  at: Date;
  id: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at.toISOString(), cursor.id]), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === "string" && typeof decoded[1] === "string") {
      const at = new Date(decoded[0]);
      if (!Number.isNaN(at.getTime()) && ID.test(decoded[1])) return { at, id: decoded[1] };
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
