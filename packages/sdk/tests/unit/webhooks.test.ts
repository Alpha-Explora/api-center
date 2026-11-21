import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import {
  ApiCenterContextError,
  ApiCenterWebhookError,
  createContextVerifier,
  createWebhookHandler,
  parsePaymentEvent,
  verifyWebhook,
  type PaymentEvent,
} from '../../src';

const NOW = Date.parse('2026-11-19T02:00:00Z');
const secret = () => `whsec_${randomBytes(32).toString('base64')}`;

const paid = {
  eventId: 'evt_1',
  contractVersion: '2.0',
  eventType: 'payment.checkout.paid',
  environment: 'test',
  organizationId: 'org_1',
  projectId: 'prj_1',
  applicationId: 'app_1',
  referenceId: 'ORDER-1',
  aggregateType: 'checkout',
  aggregateId: 'chk_1',
  aggregateVersion: 2,
  occurredAt: '2026-11-19T01:59:58.000Z',
  data: { status: 'paid', checkoutId: 'chk_1', paymentId: 'pay_1', amount: 39900, currency: 'PHP' },
};

/** Signs like APICenter's delivery service, independently of the SDK's verifier. */
function delivery(body: string, secrets: string[], timestamp = NOW / 1000, id = 'evt_1') {
  const signature = secrets
    .map((value) => `v1,${createHmac('sha256', Buffer.from(value.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`)
    .join(' ');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature };
}

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(() => 'accepted', (error: unknown) => (error as ApiCenterWebhookError).code);
}

describe('verifyWebhook', () => {
  const key = secret();
  const body = JSON.stringify(paid);

  it('returns the typed event for an authentic delivery', async () => {
    const event = await verifyWebhook(body, delivery(body, [key]), key, { now: () => NOW });
    expect(event.eventType).toBe('payment.checkout.paid');
    if (event.eventType === 'payment.checkout.paid') expect(event.data.amount).toBe(39900);
  });

  it('accepts raw bytes and fetch Headers', async () => {
    const headers = new Headers(delivery(body, [key]));
    await expect(verifyWebhook(new TextEncoder().encode(body), headers, key, { now: () => NOW })).resolves.toMatchObject({ eventId: 'evt_1' });
  });

  it('rejects tampering, the wrong secret, old timestamps and missing headers', async () => {
    const headers = delivery(body, [key]);
    expect(await code(verifyWebhook(body.replace('39900', '1'), headers, key, { now: () => NOW }))).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await code(verifyWebhook(body, headers, secret(), { now: () => NOW }))).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await code(verifyWebhook(body, headers, key, { now: () => NOW + 301_000 }))).toBe('WEBHOOK_TIMESTAMP_OUT_OF_RANGE');
    expect(await code(verifyWebhook(body, { 'webhook-id': 'x' }, key))).toBe('WEBHOOK_HEADERS_MISSING');
    expect(await code(verifyWebhook(body, headers, 'whsec_short', { now: () => NOW }))).toBe('WEBHOOK_SECRET_INVALID');
    const signedJunk = 'not json';
    expect(await code(verifyWebhook(signedJunk, delivery(signedJunk, [key]), key, { now: () => NOW }))).toBe('WEBHOOK_PAYLOAD_INVALID');
  });

  it('verifies during a rotation with either secret', async () => {
    const next = secret();
    const headers = delivery(body, [next, key]);
    await expect(verifyWebhook(body, headers, key, { now: () => NOW })).resolves.toBeDefined();
    await expect(verifyWebhook(body, headers, [next], { now: () => NOW })).resolves.toBeDefined();
  });
});

describe('createWebhookHandler', () => {
  const key = secret();
  const body = JSON.stringify(paid);
  const request = (headers: Record<string, string>, method = 'POST') => new Request('https://app.test/apicenter/events', { method, headers, body: method === 'POST' ? body : undefined });

  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('answers 204 after onEvent, 400 for an unsigned delivery, 500 when onEvent fails, 405 for other methods', async () => {
    const received: PaymentEvent[] = [];
    const handler = createWebhookHandler({ secret: key, onEvent: (event) => void received.push(event) });
    expect((await handler(request(delivery(body, [key])))).status).toBe(204);
    expect(received).toHaveLength(1);

    const bad = await handler(request({ ...delivery(body, [key]), 'webhook-signature': 'v1,AAAA' }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'WEBHOOK_SIGNATURE_INVALID' });

    const failing = createWebhookHandler({ secret: key, onEvent: () => { throw new Error('db down'); } });
    expect((await failing(request(delivery(body, [key])))).status).toBe(500);
    expect((await handler(request({}, 'GET'))).status).toBe(405);
  });
});

describe('payment events (contract 2.0)', () => {
  it('parses a paid checkout and rejects contract 1.x or broken events', () => {
    expect(parsePaymentEvent(paid)).toMatchObject({ eventType: 'payment.checkout.paid', applicationId: 'app_1' });
    expect(() => parsePaymentEvent({ ...paid, contractVersion: '1.1' })).toThrow();
    expect(() => parsePaymentEvent({ ...paid, data: { ...paid.data, amount: -1 } })).toThrow();
    const { organizationId: _drop, ...noOrganization } = paid;
    expect(() => parsePaymentEvent(noOrganization)).toThrow();
  });

  it('parses held allocations and paid and failed payouts', () => {
    const held = parsePaymentEvent({ ...paid, eventType: 'payment.allocation.held', aggregateType: 'allocation', aggregateId: 'pal_1',
      data: { status: 'held', allocationId: 'pal_1', payeeId: 'pye_1', paymentId: 'pay_1', amount: 34000, currency: 'PHP' } });
    expect(held).toMatchObject({ eventType: 'payment.allocation.held', data: { payeeId: 'pye_1', amount: 34000 } });
    const payout = { ...paid, aggregateType: 'payout', aggregateId: 'po_1' };
    const payoutData = { payoutId: 'po_1', payeeId: 'pye_1', net: 72500, fee: 1000, currency: 'PHP', trigger: 'schedule' };
    const payoutPaid = parsePaymentEvent({ ...payout, eventType: 'payment.payout.paid', data: { status: 'paid', ...payoutData } });
    if (payoutPaid.eventType !== 'payment.payout.paid') throw new Error('expected a paid payout');
    expect(payoutPaid.data.net).toBe(72500);
    const payoutFailed = parsePaymentEvent({ ...payout, eventType: 'payment.payout.failed',
      data: { status: 'failed', ...payoutData, trigger: 'cash_out', failureCode: 'invalid_destination_account' } });
    expect(payoutFailed).toMatchObject({ eventType: 'payment.payout.failed', data: { failureCode: 'invalid_destination_account' } });
    expect(() => parsePaymentEvent({ ...payout, eventType: 'payment.payout.paid', data: { status: 'paid', ...payoutData, net: 0 } })).toThrow();
  });

  it('parses paid and failed payment intents', () => {
    const intent = { ...paid, aggregateType: 'payment_intent', aggregateId: 'pi_1' };
    const intentPaid = parsePaymentEvent({ ...intent, eventType: 'payment.intent.paid',
      data: { status: 'succeeded', paymentIntentId: 'pi_1', paymentId: 'pay_1', amount: 39900, currency: 'PHP' } });
    expect(intentPaid).toMatchObject({ eventType: 'payment.intent.paid', data: { paymentIntentId: 'pi_1' } });
    const intentFailed = parsePaymentEvent({ ...intent, eventType: 'payment.intent.failed',
      data: { status: 'failed', paymentIntentId: 'pi_1', paymentId: 'pay_1', amount: 39900, currency: 'PHP',
        failureCode: 'payment_cancelled' } });
    if (intentFailed.eventType !== 'payment.intent.failed') throw new Error('expected a failed intent');
    expect(intentFailed.data.failureCode).toBe('payment_cancelled');
    expect(() => parsePaymentEvent({ ...intent, eventType: 'payment.intent.paid',
      data: { status: 'failed', paymentIntentId: 'pi_1', paymentId: 'pay_1', amount: 39900, currency: 'PHP' } })).toThrow();
  });

  it('returns event types it does not know as unrecognized instead of failing', () => {
    const later = { ...paid, eventType: 'payment.refund.succeeded', aggregateType: 'refund', data: { refundId: 'ref_1' } };
    expect(parsePaymentEvent(later)).toMatchObject({ eventType: 'unrecognized', type: 'payment.refund.succeeded', data: { refundId: 'ref_1' } });
  });
});

describe('createContextVerifier (WebCrypto)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string }), kid: 'k1' };
  const apiId = `api_${'a'.repeat(24)}`;
  const seconds = Math.floor(NOW / 1000);
  const claims = { iss: 'apicenter-gateway', aud: `apicenter-api:${apiId}`, iat: seconds, exp: seconds + 60, env_kind: 'live', jti: 'req_1', org: 'org_1', prj: 'prj_1', env: 'env_1', app: 'app_1', act: 'orders:read' };
  const token = (payload: object, kid = 'k1') => {
    const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'apicenter-context+jwt', kid })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  };
  const verify = createContextVerifier({ apiId, publicKeys: [jwk], now: () => NOW });

  it('returns the caller for a valid context', async () => {
    await expect(verify(token(claims))).resolves.toMatchObject({ applicationId: 'app_1', environment: 'live', owner: { organizationId: 'org_1', projectId: 'prj_1' } });
  });

  it('rejects a forged, foreign or expired context', async () => {
    const forged = token(claims).replace(/\.[^.]+$/, '.AAAA');
    await expect(verify(forged)).rejects.toBeInstanceOf(ApiCenterContextError);
    await expect(verify(token({ ...claims, aud: 'apicenter-api:api_other' }))).rejects.toThrow('different API');
    await expect(verify(token({ ...claims, exp: seconds - 60, iat: seconds - 120 }))).rejects.toThrow('expired');
    await expect(verify(token(claims, 'unknown'))).rejects.toThrow('not trusted');
    await expect(verify(undefined)).rejects.toThrow('missing');
  });
});
