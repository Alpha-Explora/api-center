// Standard Webhooks signing (https://www.standardwebhooks.com/). The SDK's verifyWebhook checks the
// same scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the decoded `whsec_` secret.
import { createHmac } from "node:crypto";

export const SECRET_PREFIX = "whsec_";

/** The `webhook-signature` header: one `v1,<base64>` per secret, space separated. */
export function signatureHeader(secrets: string[], id: string, timestamp: number, body: string): string {
  const content = `${id}.${timestamp}.${body}`;
  return secrets
    .map((secret) => {
      if (!secret.startsWith(SECRET_PREFIX)) throw new Error("Webhook secrets must start with whsec_");
      const key = Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");
      return `v1,${createHmac("sha256", key).update(content).digest("base64")}`;
    })
    .join(" ");
}
