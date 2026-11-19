// The gateway's Ed25519 signing key, APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: a single-line private JWK with
// a kid. It signs runtime contexts (control plane) and payment return links (payments).

import { createPrivateKey, type KeyObject } from "node:crypto";

export interface SigningKey {
  kid: string;
  key: KeyObject;
}

export function parseSigningKey(raw: string | undefined): SigningKey | undefined {
  if (!raw?.trim()) return undefined;
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("APICENTER_RUNTIME_CONTEXT_SIGNING_KEY must be an Ed25519 private JWK");
  }
  const { kty, crv, x, d, kid } = jwk;
  if (kty !== "OKP" || crv !== "Ed25519" || typeof x !== "string" || typeof d !== "string" || typeof kid !== "string" || !kid) {
    throw new Error("APICENTER_RUNTIME_CONTEXT_SIGNING_KEY must be an Ed25519 private JWK with a kid");
  }
  return { kid, key: createPrivateKey({ key: { kty, crv, x, d }, format: "jwk" }) };
}
