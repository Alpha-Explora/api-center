// The console's own sign-in session: a short Ed25519-signed token in an HttpOnly cookie, so a person stays
// signed in across tabs and for a working day instead of the hour a Google ID token lasts.
//
// Sign-in still starts with a verified Google ID token and a membership check. The console then issues this
// token, and forwards it to the gateway as X-APICenter-User-Session; the gateway verifies it with the
// matching public key (MANAGEMENT_SESSION_PUBLIC_KEYS) and still checks the member's roles and status on
// every request, so removing or suspending someone takes effect at once.
//
// Key: MANAGEMENT_SESSION_SIGNING_KEY, a single-line Ed25519 private JWK with a kid.

import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_TYPE = "apicenter-console-session+jwt";
export const SESSION_ISSUER = "apicenter-console";
export const SESSION_AUDIENCE = "apicenter-gateway";
const CLOCK_SKEW_SECONDS = 30;

export interface SessionKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export interface SessionIdentity {
  /** The Google account's subject. */
  subject: string;
  email: string;
  name?: string;
}

export interface SessionClaims extends SessionIdentity {
  issuedAt: number;
  expiresAt: number;
}

export class SessionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionTokenError";
  }
}

/** The signing key from MANAGEMENT_SESSION_SIGNING_KEY, or undefined when it is not set. */
export function sessionKeyFrom(raw: string | undefined): SessionKey | undefined {
  if (!raw?.trim()) return undefined;
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("MANAGEMENT_SESSION_SIGNING_KEY must be an Ed25519 private JWK");
  }
  const { kty, crv, x, d, kid } = jwk;
  if (kty !== "OKP" || crv !== "Ed25519" || typeof x !== "string" || typeof d !== "string" || typeof kid !== "string" || !kid) {
    throw new Error("MANAGEMENT_SESSION_SIGNING_KEY must be an Ed25519 private JWK with a kid");
  }
  const privateKey = createPrivateKey({ key: { kty, crv, x, d }, format: "jwk" });
  return { kid, privateKey, publicKey: createPublicKey(privateKey) };
}

export function issueSessionToken(key: SessionKey, identity: SessionIdentity, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: "EdDSA", typ: SESSION_TYPE, kid: key.kid };
  const payload = {
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    sub: identity.subject,
    email: identity.email,
    ...(identity.name ? { name: identity.name.slice(0, 200) } : {}),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
    jti: randomUUID(),
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), key.privateKey).toString("base64url")}`;
}

/** The claims of a token this console issued and that is still valid; throws otherwise. */
export function verifySessionToken(key: SessionKey, token: string, now = Date.now()): SessionClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SessionTokenError("Malformed session");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decode(headerPart);
  if (header.alg !== "EdDSA" || header.typ !== SESSION_TYPE || header.kid !== key.kid) throw new SessionTokenError("Unknown session key");
  const valid = verify(null, Buffer.from(`${headerPart}.${payloadPart}`), key.publicKey, Buffer.from(signaturePart, "base64url"));
  if (!valid) throw new SessionTokenError("Session signature is invalid");
  const claims = decode(payloadPart);
  const nowSeconds = Math.floor(now / 1000);
  if (claims.iss !== SESSION_ISSUER || claims.aud !== SESSION_AUDIENCE) throw new SessionTokenError("Session is not for this console");
  if (typeof claims.exp !== "number" || typeof claims.iat !== "number") throw new SessionTokenError("Session has no lifetime");
  if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) throw new SessionTokenError("Session has expired");
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new SessionTokenError("Session is not yet valid");
  if (claims.exp - claims.iat > SESSION_TTL_SECONDS) throw new SessionTokenError("Session lifetime is too long");
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) {
    throw new SessionTokenError("Session has no identity");
  }
  return {
    subject: claims.sub,
    email: claims.email,
    ...(typeof claims.name === "string" && claims.name ? { name: claims.name } : {}),
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  };
}

/**
 * The cookie's name: `__Host-` on HTTPS, which browsers only accept as Secure, host-only and Path=/;
 * a plain name on http://localhost.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-apicenter_session" : "apicenter_session";
}

export function sessionCookie(token: string, secure: boolean): string {
  return [`${sessionCookieName(secure)}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_SECONDS}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  return [`${sessionCookieName(secure)}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

/** The session token from a Cookie header, if there is one. */
export function sessionTokenFromCookies(cookieHeader: string | null | undefined, secure: boolean): string | undefined {
  if (!cookieHeader) return undefined;
  const name = sessionCookieName(secure);
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || undefined;
  }
  return undefined;
}

/** Whether the console is served over HTTPS, so the cookie must be Secure. */
export function isSecureConsole(requestUrl: string, env: Record<string, string | undefined> = process.env): boolean {
  const configured = env.MANAGEMENT_PUBLIC_BASE_URL?.trim();
  if (configured?.startsWith("https://")) return true;
  if (configured?.startsWith("http://")) return false;
  return requestUrl.startsWith("https://");
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(part: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new SessionTokenError("Malformed session");
  }
}
