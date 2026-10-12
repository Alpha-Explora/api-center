
import { ApiCenter } from '@alpha-explora/apicenter-sdk';

interface PaymentClient {
  checkouts: {
    create(input: { referenceId: string; amount: { amountMinor: number; currency: 'PHP' }; successUrl: string; cancelUrl: string; metadata?: Record<string, string> }, options: { idempotencyKey: string }): Promise<{ checkoutId: string; referenceId: string; aggregateVersion?: number } | { status: 'pending'; resourceId: string }>;
    get(id: string): Promise<{ checkoutId: string; referenceId: string; aggregateVersion?: number }>;
  };
}
export interface PaymentSmokeEvent {
  eventId: string;
  contractVersion: string;
  eventType: string;
  ownerTribeId: string;
  consumerServiceId: string;
  referenceId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface PaymentSmokeHarness {
  injectVerifiedEvent(event: PaymentSmokeEvent): Promise<PaymentSmokeEvent>;
  waitForPublishedEvent(input: { eventType: string; aggregateId: string }): Promise<PaymentSmokeEvent>;
  waitForProjection(input: { referenceId: string; aggregateVersion: number }): Promise<{ status: string; aggregateVersion: number }>;
  entitlement(input: { referenceId: string }): Promise<{ status: string }>;
}

export interface PaymentSmokeOptions {
  payments: PaymentClient;
  harness: PaymentSmokeHarness;
  idempotencyKey: string;
  referenceId: string;
  ownerTribeId: string;
  consumerServiceId: string;
  successUrl: string;
  cancelUrl: string;
  amountMinor?: number;
  now?: () => string;
}

export interface PaymentSmokeEvidence {
  checkoutId: string;
  referenceId: string;
  aggregateVersion: number;
  eventId: string;
  projectionStatus: string;
  entitlementStatus: string;
  duplicateProjectionStable: boolean;
  providerPayloadLeak: boolean;
}

export async function runPaymentPlatformSmoke(options: PaymentSmokeOptions): Promise<PaymentSmokeEvidence> {
  if (!options.idempotencyKey.trim()) throw new Error('A fixed smoke idempotency key is required');
  const amountMinor = options.amountMinor ?? 39900;
  const checkoutInput = {
    referenceId: options.referenceId,
    amount: { amountMinor, currency: 'PHP' as const },
    successUrl: options.successUrl,
    cancelUrl: options.cancelUrl,
    metadata: { smoke: 'true' },
  };
  const requestOptions = { idempotencyKey: options.idempotencyKey };
  const first = await options.payments.checkouts.create(checkoutInput, requestOptions);
  const replay = await options.payments.checkouts.create(checkoutInput, requestOptions);
  if ('resourceId' in first || 'resourceId' in replay) {
    throw new Error('Payment checkout is still pending; the downstream smoke checks require a completed checkout resource');
  }
  if (first.checkoutId !== replay.checkoutId || replay.referenceId !== options.referenceId) {
    throw new Error('Checkout idempotency replay returned a different resource');
  }
  const retrieved = await options.payments.checkouts.get(first.checkoutId);
  if (retrieved.checkoutId !== first.checkoutId) throw new Error('Checkout retrieval returned the wrong resource');

  const event: PaymentSmokeEvent = {
    eventId: `smoke-${options.idempotencyKey}`,
    contractVersion: '1.0',
    eventType: 'payment.checkout.paid',
    ownerTribeId: options.ownerTribeId,
    consumerServiceId: options.consumerServiceId,
    referenceId: options.referenceId,
    aggregateType: 'checkout',
    aggregateId: first.checkoutId,
    aggregateVersion: Math.max(first.aggregateVersion ?? 1, 1),
    occurredAt: (options.now ?? (() => new Date().toISOString()))(),
    data: {
      environment: 'test',
      status: 'paid',
      referenceId: options.referenceId,
      checkoutId: first.checkoutId,
      amount: { amountMinor, currency: 'PHP' },
      aggregateVersion: Math.max(first.aggregateVersion ?? 1, 1),
    },
  };
  const injected = await options.harness.injectVerifiedEvent(event);
  const published = await options.harness.waitForPublishedEvent({ eventType: event.eventType, aggregateId: event.aggregateId });
  const projection = await options.harness.waitForProjection({ referenceId: options.referenceId, aggregateVersion: event.aggregateVersion });
  const entitlement = await options.harness.entitlement({ referenceId: options.referenceId });
  if (published.eventId !== injected.eventId || projection.status !== 'paid' || entitlement.status !== 'active') {
    throw new Error('Payment smoke did not reach a paid projection and active entitlement');
  }

  const stale = { ...event, eventId: `${event.eventId}-stale`, aggregateVersion: Math.max(event.aggregateVersion - 1, 1), data: { ...event.data, aggregateVersion: Math.max(event.aggregateVersion - 1, 1) } };
  await options.harness.injectVerifiedEvent(stale);
  const afterStale = await options.harness.waitForProjection({ referenceId: options.referenceId, aggregateVersion: event.aggregateVersion });
  const duplicateProjectionStable = afterStale.aggregateVersion === projection.aggregateVersion && afterStale.status === projection.status;
  if (!duplicateProjectionStable) throw new Error('Stale duplicate changed the AlphaCI projection');

  const serialized = JSON.stringify(published);
  const providerPayloadLeak = /providerData|paymongo|secretKey|authorization/i.test(serialized);
  if (providerPayloadLeak) throw new Error('Canonical payment event contains provider payload data');
  return { checkoutId: first.checkoutId, referenceId: options.referenceId, aggregateVersion: event.aggregateVersion, eventId: event.eventId, projectionStatus: projection.status, entitlementStatus: entitlement.status, duplicateProjectionStable, providerPayloadLeak };
}

async function main(): Promise<void> {
  const baseUrl = process.env.APICENTER_URL;
  const paymentApiKey = process.env.APICENTER_PAYMENT_API_KEY;
  const serviceId = process.env.APICENTER_SERVICE_ID;
  const serviceSecret = process.env.APICENTER_SERVICE_SECRET;
  const tribeId = process.env.APICENTER_OWNER_TRIBE_ID;
  const eventInjectorUrl = process.env.PAYMENT_SMOKE_EVENT_INJECTOR_URL;
  const observerUrl = process.env.PAYMENT_SMOKE_PUBSUB_OBSERVER_URL;
  const projectionUrl = process.env.PAYMENT_SMOKE_PROJECTION_URL;
  const entitlementUrl = process.env.PAYMENT_SMOKE_ENTITLEMENT_URL;
  if (!baseUrl || !tribeId || !eventInjectorUrl || !observerUrl || !projectionUrl || !entitlementUrl) {
    throw new Error('APICENTER_URL, APICENTER_OWNER_TRIBE_ID, PAYMENT_SMOKE_EVENT_INJECTOR_URL, PAYMENT_SMOKE_PUBSUB_OBSERVER_URL, PAYMENT_SMOKE_PROJECTION_URL, and PAYMENT_SMOKE_ENTITLEMENT_URL are required');
  }
  if (!paymentApiKey && (!serviceId || !serviceSecret)) {
    throw new Error('Configure APICENTER_PAYMENT_API_KEY or both APICENTER_SERVICE_ID and APICENTER_SERVICE_SECRET');
  }
  const client = new ApiCenter({
    baseUrl,
    ...(serviceId && serviceSecret ? {
      auth: {
        serviceId,
        environment: process.env.APICENTER_ENVIRONMENT === 'live' ? 'live' as const : 'test' as const,
        secret: serviceSecret,
      },
    } : {}),
    ...(paymentApiKey ? { paymentApiKey } : {}),
  });
  const token = process.env.PAYMENT_SMOKE_EVENT_INJECTOR_TOKEN;
  const response = await runPaymentPlatformSmoke({
    payments: client.payments,
    idempotencyKey: process.env.PAYMENT_SMOKE_IDEMPOTENCY_KEY ?? `payment-platform-smoke-${Date.now()}`,
    referenceId: process.env.PAYMENT_SMOKE_REFERENCE_ID ?? `payment-platform-smoke-${Date.now()}`,
    ownerTribeId: tribeId,
    consumerServiceId: process.env.APICENTER_CONSUMER_SERVICE_ID ?? 'alphaci-backend',
    successUrl: process.env.PAYMENT_SMOKE_SUCCESS_URL ?? 'https://example.test/payment/success',
    cancelUrl: process.env.PAYMENT_SMOKE_CANCEL_URL ?? 'https://example.test/payment/cancel',
    harness: createHttpHarness({ eventInjectorUrl, observerUrl, projectionUrl, entitlementUrl }, token),
  });
  console.log(JSON.stringify(response, null, 2));
}

function createHttpHarness(urls: { eventInjectorUrl: string; observerUrl: string; projectionUrl: string; entitlementUrl: string }, token?: string): PaymentSmokeHarness {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const getJson = async (url: string): Promise<any> => { const response = await fetch(url, { headers }); if (!response.ok) throw new Error(`Smoke harness request failed: ${response.status}`); return response.json(); };
  return {
    async injectVerifiedEvent(event) { const response = await fetch(urls.eventInjectorUrl, { method: 'POST', headers, body: JSON.stringify(event) }); if (!response.ok) throw new Error(`Event injection failed: ${response.status}`); return response.json() as Promise<PaymentSmokeEvent>; },
    waitForPublishedEvent: (input) => getJson(`${urls.observerUrl}?eventType=${encodeURIComponent(input.eventType)}&aggregateId=${encodeURIComponent(input.aggregateId)}`),
    waitForProjection: (input) => getJson(`${urls.projectionUrl}?referenceId=${encodeURIComponent(input.referenceId)}&aggregateVersion=${input.aggregateVersion}`),
    entitlement: (input) => getJson(`${urls.entitlementUrl}?referenceId=${encodeURIComponent(input.referenceId)}`),
  };
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
