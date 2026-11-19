// Verifies APICenter webhook deliveries. Deliveries follow the Standard Webhooks scheme
// (https://www.standardwebhooks.com/): the signed content is `${webhook-id}.${webhook-timestamp}.${body}`,
// signed with HMAC-SHA256 under the endpoint's `whsec_` secret, and sent as `v1,<base64>` in the
// space-separated `webhook-signature` header (several during a secret rotation). WebCrypto only.
import { base64ToBytes, equalBytes, fromUtf8, utf8 } from '../internal/encoding.js';
import { parsePaymentEvent, type PaymentEvent } from '../payment/events.js';

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export type ApiCenterWebhookErrorCode =
  | 'WEBHOOK_HEADERS_MISSING'
  | 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_SECRET_INVALID'
  | 'WEBHOOK_PAYLOAD_INVALID';

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

async function hmac(secret: string, content: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = base64ToBytes(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : '');
  } catch {
    key = new Uint8Array();
  }
  if (key.length < 24) throw new ApiCenterWebhookError('WEBHOOK_SECRET_INVALID', 'The webhook secret must be the whsec_ value APICenter issued');
  const imported = await globalThis.crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', imported, content));
}

/**
 * Checks a delivery's signature and timestamp against the endpoint secret (or several during a
 * rotation) and returns the typed payment event. Pass the raw request body, before any JSON parsing.
 * Rejects with ApiCenterWebhookError when the delivery is not authentic, too old or malformed.
 */
export async function verifyWebhook(
  payload: string | Uint8Array,
  headers: WebhookHeaders,
  secret: string | string[],
  options: VerifyWebhookOptions = {},
): Promise<PaymentEvent> {
  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatures = header(headers, 'webhook-signature');
  if (!id || !timestamp || !signatures) {
    throw new ApiCenterWebhookError('WEBHOOK_HEADERS_MISSING', 'webhook-id, webhook-timestamp and webhook-signature are required');
  }
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > (options.toleranceSeconds ?? 300)) {
    throw new ApiCenterWebhookError('WEBHOOK_TIMESTAMP_OUT_OF_RANGE', 'The webhook timestamp is outside the accepted window');
  }

  const body = typeof payload === 'string' ? payload : fromUtf8(payload);
  const content = utf8(`${id}.${timestamp}.${body}`);
  const presented = signatures
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .flatMap((entry) => {
      try {
        return [base64ToBytes(entry.slice(3))];
      } catch {
        return [];
      }
    });
  let valid = false;
  for (const candidate of Array.isArray(secret) ? secret : [secret]) {
    const expected = await hmac(candidate, content);
    if (presented.some((signature) => equalBytes(signature, expected))) valid = true;
  }
  if (!valid) throw new ApiCenterWebhookError('WEBHOOK_SIGNATURE_INVALID', 'No webhook signature matches the endpoint secret');

  try {
    return parsePaymentEvent(JSON.parse(body));
  } catch {
    throw new ApiCenterWebhookError('WEBHOOK_PAYLOAD_INVALID', 'The webhook body is not a valid payment event');
  }
}

export interface WebhookHandlerOptions extends VerifyWebhookOptions {
  /** The endpoint's signing secret, or both secrets during a rotation. */
  secret: string | string[];
  /**
   * Called once per verified delivery. Store the event (deduplicating by eventId) and return; a
   * thrown error answers 500 so APICenter retries the delivery.
   */
  onEvent(event: PaymentEvent): void | Promise<void>;
}

/**
 * A request handler for fetch-style servers (Next.js route handlers, Cloudflare Workers, Deno,
 * Bun, Hono): `export const POST = createWebhookHandler({ secret, onEvent })`. It answers 204 when
 * the event was handled, 400 when the delivery is not authentic, and 500 when onEvent throws.
 */
export function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
    let event: PaymentEvent;
    try {
      event = await verifyWebhook(await request.text(), request.headers, options.secret, options);
    } catch (error) {
      if (error instanceof ApiCenterWebhookError) return Response.json({ error: error.code }, { status: 400 });
      throw error;
    }
    try {
      await options.onEvent(event);
    } catch {
      return new Response(null, { status: 500 });
    }
    return new Response(null, { status: 204 });
  };
}
