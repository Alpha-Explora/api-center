// Verifies the management console's own sign-in session (X-APICenter-User-Session): an Ed25519-signed
// token the console issues after checking a Google ID token and the account's access. The console holds
// the private key (MANAGEMENT_SESSION_SIGNING_KEY); the gateway holds the public keys
// (MANAGEMENT_SESSION_PUBLIC_KEYS, a JSON array of public JWKs with kids). The format is the console's
// (apps/management/src/lib/server/console-session.ts); tests/unit verifies one with the other.

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { ServiceUnavailableError, UnauthorizedError } from "@shared/errors";
import type { VerifiedConsoleUser } from "./console-actor.guard";

const TYPE = "apicenter-console-session+jwt";
const ISSUER = "apicenter-console";
const AUDIENCE = "apicenter-gateway";
/** The console issues 12-hour sessions; anything longer was not issued by it. */
const MAX_LIFETIME_SECONDS = 12 * 60 * 60;
const CLOCK_SKEW_SECONDS = 30;

export type ConsoleSessionKeys = Map<string, KeyObject>;

/** Public keys from MANAGEMENT_SESSION_PUBLIC_KEYS; empty when it is not set. Private key material is refused. */
export function loadConsoleSessionKeys(raw: string | undefined): ConsoleSessionKeys {
  const keys: ConsoleSessionKeys = new Map();
  if (!raw?.trim()) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MANAGEMENT_SESSION_PUBLIC_KEYS must be a JSON array of Ed25519 public JWKs");
  }
  if (!Array.isArray(parsed)) throw new Error("MANAGEMENT_SESSION_PUBLIC_KEYS must be a JSON array of Ed25519 public JWKs");
  for (const entry of parsed as Record<string, unknown>[]) {
    if (!entry || typeof entry !== "object") throw new Error("MANAGEMENT_SESSION_PUBLIC_KEYS entries must be JWKs");
    if ("d" in entry) throw new Error("MANAGEMENT_SESSION_PUBLIC_KEYS must not contain private key material");
    const { kty, crv, x, kid } = entry;
    if (kty !== "OKP" || crv !== "Ed25519" || typeof x !== "string" || typeof kid !== "string" || !kid) {
      throw new Error("MANAGEMENT_SESSION_PUBLIC_KEYS entries must be Ed25519 public JWKs with a kid");
    }
    keys.set(kid, createPublicKey({ key: { kty, crv, x }, format: "jwk" }));
  }
  return keys;
}

/** The person a console session names. Throws 401 for anything the console did not issue or that has expired. */
export function verifyConsoleSession(token: string, keys: ConsoleSessionKeys, now = Date.now()): VerifiedConsoleUser {
  if (keys.size === 0) throw new ServiceUnavailableError("Console sessions are not configured (MANAGEMENT_SESSION_PUBLIC_KEYS)");
  const invalid = () => new UnauthorizedError("The console session is invalid or expired");
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid();
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decode(headerPart);
  const key = typeof header?.kid === "string" ? keys.get(header.kid) : undefined;
  if (!header || header.alg !== "EdDSA" || header.typ !== TYPE || !key) throw invalid();
  if (!verify(null, Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, "base64url"))) throw invalid();
  const claims = decode(payloadPart);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !claims ||
    claims.iss !== ISSUER ||
    claims.aud !== AUDIENCE ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS ||
    claims.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
    claims.exp - claims.iat > MAX_LIFETIME_SECONDS ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    !claims.email
  ) {
    throw invalid();
  }
  const name = typeof claims.name === "string" ? claims.name.trim() : "";
  return { email: claims.email.trim().toLowerCase(), subject: claims.sub, ...(name ? { name } : {}) };
}

function decode(part: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
