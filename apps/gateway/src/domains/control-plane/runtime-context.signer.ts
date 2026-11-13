// Signs the short-lived caller context the gateway forwards to capability runtimes for
// control-plane applications. Runtimes verify it with packages/runtime verifyRuntimeContext.
// Key: APICENTER_RUNTIME_CONTEXT_SIGNING_KEY, a single-line Ed25519 private JWK with a kid.

import { Injectable, Optional } from "@nestjs/common";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { ServiceUnavailableError } from "@shared/errors";
import type { ApplicationIdentity, ResourceOwner } from "./control-plane.types";

export const RUNTIME_CONTEXT_LIFETIME_SECONDS = 60;
const CONTEXT_TYPE = "apicenter-context+jwt";
const ISSUER = "apicenter-gateway";

export function runtimeAudience(capability: string): string {
  return `apicenter-runtime:${capability}`;
}

interface SigningKey {
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

@Injectable()
export class RuntimeContextSigner {
  private readonly signingKey: SigningKey | undefined;

  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    this.signingKey = parseSigningKey(env.APICENTER_RUNTIME_CONTEXT_SIGNING_KEY);
  }

  sign(input: {
    identity: ApplicationIdentity;
    /** Defaults to (organization, project). */
    resourceOwner?: ResourceOwner;
    capability: string;
    action: string;
    requestId: string;
    now?: Date;
  }): string {
    if (!this.signingKey) {
      throw new ServiceUnavailableError("Runtime context signing is not configured");
    }
    const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const header = { alg: "EdDSA", typ: CONTEXT_TYPE, kid: this.signingKey.kid };
    const payload = {
      iss: ISSUER,
      aud: runtimeAudience(input.capability),
      iat: issuedAt,
      exp: issuedAt + RUNTIME_CONTEXT_LIFETIME_SECONDS,
      jti: input.requestId,
      org: input.identity.organizationId,
      prj: input.identity.projectId,
      env: input.identity.environmentId,
      env_kind: input.identity.environmentKind,
      app: input.identity.applicationId,
      act: input.action,
      own_grp: input.resourceOwner?.groupId ?? input.identity.organizationId,
      own_prj: input.resourceOwner?.projectId ?? input.identity.projectId,
    };
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = sign(null, Buffer.from(signingInput, "utf8"), this.signingKey.key);
    return `${signingInput}.${signature.toString("base64url")}`;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
