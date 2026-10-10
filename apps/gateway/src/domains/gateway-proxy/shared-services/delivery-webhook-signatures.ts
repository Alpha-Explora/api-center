import { createHash } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import twilio from 'twilio';

export function verifyResendSignature(
  secret: string,
  rawBody: Buffer,
  headers: { id: string; timestamp: string; signature: string },
): unknown {
  return new Webhook(secret).verify(rawBody, {
    'webhook-id': headers.id,
    'webhook-timestamp': headers.timestamp,
    'webhook-signature': headers.signature,
  });
}

export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, unknown>,
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}

/** Twilio status callbacks have no event SID. Hash the complete, sorted form payload for retry-stable IDs. */
export function twilioProviderEventId(params: Record<string, unknown>): string {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(params).sort(([left], [right]) => left.localeCompare(right))));
  return `twilio_${createHash('sha256').update(canonical).digest('hex')}`;
}
