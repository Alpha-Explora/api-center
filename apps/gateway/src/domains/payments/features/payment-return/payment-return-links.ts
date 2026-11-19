// Payment providers send the customer back to an HTTPS page. An app's own link (myapp://booking/1)
// becomes an APICenter page that forwards to it. The page only forwards to links the gateway signed
// itself, so it cannot be used to send people anywhere else.

import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { ServiceUnavailableError } from "@shared/errors";
import { parseSigningKey } from "@shared/signing-key";

export const PAYMENT_RETURN_PATH = "/api/v1/payment-return";
const SIGNING_CONTEXT = "apicenter-payment-return\n";
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "filesystem:"]);
const MAX_URL_LENGTH = 2048;

/** `web` links go to the provider as they are; `app` links go through the forwarding page. */
export function returnUrlKind(value: string): "web" | "app" {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidReturnUrl();
  }
  if (value.length > MAX_URL_LENGTH || UNSAFE_SCHEMES.has(url.protocol)) throw invalidReturnUrl();
  return url.protocol === "https:" || url.protocol === "http:" ? "web" : "app";
}

function invalidReturnUrl() {
  return new BadRequestException({
    code: "INVALID_RETURN_URL",
    message: "Return links must be HTTPS links or your app's own links",
  });
}

@Injectable()
export class PaymentReturnLinks {
  private readonly key: KeyObject | undefined;
  private readonly publicKey: KeyObject | undefined;
  private readonly publicBaseUrl: string | undefined;

  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    this.key = parseSigningKey(env.APICENTER_RUNTIME_CONTEXT_SIGNING_KEY)?.key;
    this.publicKey = this.key ? createPublicKey(this.key) : undefined;
    this.publicBaseUrl = env.APICENTER_PUBLIC_URL?.replace(/\/$/, "") || undefined;
  }

  /** The link to give the provider for a customer-facing return URL. */
  forProvider(value: string, requestOrigin: string): string {
    if (returnUrlKind(value) === "web") return value;
    if (!this.key) throw new ServiceUnavailableError("Payment return links are not configured");
    const signature = sign(null, Buffer.from(SIGNING_CONTEXT + value, "utf8"), this.key);
    const token = `${Buffer.from(value, "utf8").toString("base64url")}.${signature.toString("base64url")}`;
    return `${this.publicBaseUrl ?? requestOrigin}${PAYMENT_RETURN_PATH}/${token}`;
  }

  /** The app link a forwarding token names, or undefined when the gateway did not sign it. */
  target(token: string): string | undefined {
    if (!this.publicKey) return undefined;
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra !== undefined) return undefined;
    const value = Buffer.from(encoded, "base64url").toString("utf8");
    const valid = verify(null, Buffer.from(SIGNING_CONTEXT + value, "utf8"), this.publicKey,
      Buffer.from(signature, "base64url"));
    return valid ? value : undefined;
  }
}
