import { request } from "@/lib/api-center/client-core";

export async function createReplacement() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const plaintext =
    "apic_" +
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { plaintext, hash };
}
export function rotateServiceCredential(input: {
  serviceId: string;
  environment: "test" | "live";
  action: "start" | "verify" | "revoke-old";
  operationId: string;
  secretHashSha256?: string;
  reason: string;
  typedPhrase: string;
}) {
  const { serviceId, typedPhrase, ...body } = input;
  return request(
    `/api/local/services/${encodeURIComponent(serviceId)}/credential-rotation`,
    {
      method: "POST",
      body: JSON.stringify({
        ...body,
        confirmation: { typedPhrase, reason: input.reason },
      }),
    },
  );
}
