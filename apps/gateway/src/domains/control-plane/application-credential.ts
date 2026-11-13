// Application credential format: ak_<test|live>_<16 lookup chars>_<43-char secret>.
// The lookup prefix (everything before the last separator) locates the row; only a SHA-256
// verifier of the full key is stored. The environment stored on the row is authoritative; the
// prefix is a human hint.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { EnvironmentKind } from "./control-plane.types";

const LOOKUP_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CREDENTIAL_PATTERN = /^(ak_(test|live)_[a-z0-9]{16})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedCredential {
  plaintext: string;
  lookupPrefix: string;
  verifierSha256: string;
}

export interface ParsedCredential {
  lookupPrefix: string;
  environmentKind: EnvironmentKind;
}

export function generateApplicationCredential(kind: EnvironmentKind): GeneratedCredential {
  const lookupPrefix = `ak_${kind}_${randomLowercase(16)}`;
  const plaintext = `${lookupPrefix}_${randomBytes(32).toString("base64url")}`;
  return { plaintext, lookupPrefix, verifierSha256: credentialVerifier(plaintext) };
}

export function parseApplicationCredential(raw: string): ParsedCredential | undefined {
  const match = CREDENTIAL_PATTERN.exec(raw);
  if (!match) return undefined;
  return { lookupPrefix: match[1], environmentKind: match[2] as EnvironmentKind };
}

export function credentialVerifier(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function credentialMatches(plaintext: string, storedVerifier: string): boolean {
  const presented = Buffer.from(credentialVerifier(plaintext), "hex");
  const stored = Buffer.from(storedVerifier, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

/** Opaque, prefixed resource identifier: `<prefix>_<24 lowercase alphanumerics>`. */
export function newResourceId(prefix: "prj" | "env" | "app" | "grt" | "crd" | "api"): string {
  return `${prefix}_${randomLowercase(24)}`;
}

function randomLowercase(length: number): string {
  // Rejection sampling keeps the distribution uniform over the 36-character alphabet.
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 252) out += LOOKUP_ALPHABET[byte % 36];
      if (out.length === length) break;
    }
  }
  return out;
}
