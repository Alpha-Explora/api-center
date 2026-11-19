// Verifies APICenter webhook deliveries. Deliveries follow the Standard Webhooks scheme
// (https://www.standardwebhooks.com/): the signed content is `${webhook-id}.${webhook-timestamp}.${body}`,
// signed with HMAC-SHA256 under the endpoint's `whsec_` secret, and sent as `v1,<base64>` in the
// space-separated `webhook-signature` header (several during a secret rotation).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parsePaymentEvent, type PaymentEvent } from '../payment/events';

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export type ApiCenterWebhookErrorCode =
  | 'WEBHOOK_HEADERS_MISSING'
  | 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_SECRET_INVALID';

export class ApiCenterWebhookError extends Error {
  constructor(readonly code: ApiCenterWebhookErrorCode, message: string) {
    super(message);
    this.name = 'ApiCenterWebhookError';
  }
}

export interface VerifyWebhookOptions {
  /** Largest accepted clock difference, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current time in milliseconds; for tests. */
  now?: () => number;
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

function secretBytes(secret: string): Buffer {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : '';
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 24) throw new ApiCenterWebhookError('WEBHOOK_SECRET_INVALID', 'The webhook secret must be the whsec_ value APICenter issued');
  return bytes;
}

/**
 * Checks a delivery's signature and timestamp against the endpoint secret (or several during a
 * rotation) and returns the parsed payment event. Pass the raw request body, before any JSON parsing.
 * Throws ApiCenterWebhookError when the delivery is not authentic or too old.
 */
export function verifyWebhook(
  payload: string | Uint8Array,
  headers: WebhookHeaders,
  secret: string | string[],
  options: VerifyWebhookOptions = {},
): PaymentEvent {
  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatures = header(headers, 'webhook-signature');
  if (!id || !timestamp || !signatures) {
    throw new ApiCenterWebhookError('WEBHOOK_HEADERS_MISSING', 'webhook-id, webhook-timestamp and webhook-signature are required');
  }

  const seconds = Number(timestamp);
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - seconds) > (options.toleranceSeconds ?? 300)) {
    throw new ApiCenterWebhookError('WEBHOOK_TIMESTAMP_OUT_OF_RANGE', 'The webhook timestamp is outside the accepted window');
  }

  const body = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
  const content = `${id}.${timestamp}.${body}`;
  const presented = signatures
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => Buffer.from(entry.slice(3), 'base64'));
  const valid = (Array.isArray(secret) ? secret : [secret]).some((candidate) => {
    const expected = createHmac('sha256', secretBytes(candidate)).update(content).digest();
    return presented.some((signature) => signature.length === expected.length && timingSafeEqual(signature, expected));
  });
  if (!valid) throw new ApiCenterWebhookError('WEBHOOK_SIGNATURE_INVALID', 'No webhook signature matches the endpoint secret');

  return parsePaymentEvent(JSON.parse(body));
}
