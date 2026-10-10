import crypto from 'node:crypto';
import { PayMongoError } from '../../shared/payment-errors';
import { OwnerRecord, PaymentOwnerStore, VerifiedWebhook } from '../../shared/payment-owner-store';
import { toPublicId } from '../../shared/payment-ids';

const isPaidPayment = (payment: any): boolean => payment?.type === 'payment'
  && typeof payment.id === 'string' && payment.id.startsWith('pay_') && payment.attributes?.status === 'paid';

/** PayMongo's reference number for the link a payment was made through. */
function linkReference(payment: any): string | undefined {
  const attributes = payment?.attributes || {};
  for (const value of [attributes.external_reference_number, attributes.metadata?.pm_reference_number]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/** The last paid payment listed on a PayMongo link object. Entries may be payments or { data: payment }. */
function linkObjectPaymentId(link: any): string | undefined {
  const fields = link?.attributes || link || {};
  const ids = (Array.isArray(fields.payments) ? fields.payments : [])
    .map((entry: any) => entry?.data ?? entry)
    .filter((payment: any) => typeof payment?.id === 'string' && payment.id.startsWith('pay_')
      && (payment.attributes?.status ?? payment.status ?? 'paid') === 'paid')
    .map((payment: any) => payment.id as string);
  return ids[ids.length - 1];
}

export class WebhooksService {
  constructor(private readonly owners = PaymentOwnerStore.getInstance()) {}
  async processWebhook(payload: any, options: { signatureHeader?: string; rawBody?: Buffer; environment?: string } = {}) {
    const environment = options.environment;
    const secret = environment === 'live' ? process.env.PAYMONGO_LIVE_WEBHOOK_SECRET : process.env.PAYMONGO_TEST_WEBHOOK_SECRET;
    if (!secret) throw new PayMongoError('PayMongo webhook secret is not configured', 503, 'WEBHOOK_NOT_CONFIGURED');
    if (!options.rawBody || !options.signatureHeader || (environment !== 'live' && environment !== 'test')) {
      throw new PayMongoError('Invalid PayMongo webhook signature', 401, 'INVALID_SIGNATURE');
    }
    const parts = new Map(options.signatureHeader.split(',').map((part) => {
      const [key, ...value] = part.trim().split('=');
      return [key, value.join('=')];
    }));
    const timestamp = parts.get('t');
    const signature = parts.get(environment === 'live' ? 'li' : 'te');
    const expected = timestamp && crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${options.rawBody.toString('utf8')}`).digest('hex');
    if (!signature || !expected || !/^[a-f0-9]{64}$/i.test(signature)
      || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new PayMongoError('Invalid PayMongo webhook signature', 401, 'INVALID_SIGNATURE');
    }
    const providerEventId = payload?.data?.id;
    if (typeof providerEventId !== 'string' || !providerEventId.trim()) {
      throw new PayMongoError('PayMongo webhook event ID is required', 400, 'INVALID_WEBHOOK_EVENT');
    }
    const eventType = payload?.data?.attributes?.type;
    const resourceData = payload?.data?.attributes?.data || {};
    if (payload?.data?.attributes?.livemode !== (environment === 'live')) {
      throw new PayMongoError('Webhook environment does not match payment', 403, 'ENVIRONMENT_MISMATCH');
    }
    let source: OwnerRecord | undefined;
    let payments: any[] = [];
    let linkEvent = false;
    let linkPaymentId: string | undefined;
    const isLinkObject = typeof resourceData.id === 'string' && resourceData.id.startsWith('link_');
    if (eventType === 'checkout_session.payment.paid' && resourceData.id?.startsWith('cs_')) {
      source = await this.owners.findWebhookSource('checkout', toPublicId('chk', resourceData.id), environment);
      payments = Array.isArray(resourceData.attributes?.payments) ? resourceData.attributes.payments : [];
    } else if ((eventType === 'payment.paid' && resourceData.attributes?.origin === 'links')
      || (eventType === 'link.payment.paid' && !isLinkObject)) {
      // A link payment's payment_intent_id belongs to PayMongo, so it is matched on the link's PayMongo
      // reference number. Only the number saved when the link was created can match.
      linkEvent = true;
      const reference = linkReference(resourceData);
      if (isPaidPayment(resourceData) && reference) {
        source = await this.owners.findWebhookSourceByProviderReference('payment_link', reference, environment);
        linkPaymentId = resourceData.id;
      }
    } else if (eventType === 'link.payment.paid') {
      linkEvent = true;
      source = await this.owners.findWebhookSource('payment_link', toPublicId('pl', resourceData.id), environment);
      linkPaymentId = linkObjectPaymentId(resourceData);
    } else if (eventType === 'payment.paid' && resourceData.id?.startsWith('pay_')) {
      const intentId = resourceData.attributes?.payment_intent_id;
      if (typeof intentId === 'string' && intentId.startsWith('pi_')) {
        source = await this.owners.findWebhookSource('intent', intentId, environment);
        payments = [resourceData];
      }
    }
    if (!source) return { event: 'ignored', data: { eventType, updated: false } };

    if (linkEvent) {
      const applied = await this.owners.applyVerifiedWebhook({ providerEventId, environment, eventType,
        payloadHash: crypto.createHash('sha256').update(options.rawBody).digest('hex'),
        receiptStatus: 'processed', updates: [{ ...source, status: 'paid',
          snapshot: { ...source.snapshot, status: 'paid', paidAt: new Date().toISOString(),
            ...(linkPaymentId ? { paymentId: linkPaymentId } : {}) } }] });
      return { event: applied.duplicate ? 'duplicate' : 'processed', data: { eventType, updated: applied.duplicate ? 0 : 1 } };
    }

    const paid = payments.filter(isPaidPayment);
    if (paid.length === 0) return { event: 'processed', data: { eventType, updated: 0 } };
    const updates: OwnerRecord[] = paid.map((payment) => ({
      ...source, resourceType: 'payment', resourceId: payment.id,
      snapshot: { paymentId: payment.id, status: 'paid', amount: payment.attributes.amount,
        currency: payment.attributes.currency, sourceId: source.resourceId },
    }));
    updates.push({ ...source, snapshot: { ...source.snapshot,
      status: eventType === 'payment.paid' ? 'succeeded' : 'paid', paymentId: paid[0].id } });

    const queued = eventType === 'checkout_session.payment.paid'
      ? this.checkoutPaidEvent(source, paid[0], payload)
      : { receiptStatus: 'processed' as const };
    const applied = await this.owners.applyVerifiedWebhook({
      providerEventId,
      environment,
      eventType,
      payloadHash: crypto.createHash('sha256').update(options.rawBody).digest('hex'),
      updates,
      ...queued,
    });
    if (queued.receiptStatus === 'needs_reconciliation' && !applied.duplicate) {
      console.warn(JSON.stringify({ type: 'apicenter_payment_webhook_needs_reconciliation',
        providerEventId, environment, reason: queued.receiptNote }));
    }
    return { event: applied.duplicate ? 'duplicate' : 'processed',
      data: { eventType, updated: applied.duplicate ? 0 : paid.length, queued: applied.queued } };
  }

  /**
   * The event consumers receive for a paid checkout. A checkout that cannot be described completely is
   * still recorded as paid, but flagged for reconciliation instead of queueing an event the publisher rejects.
   */
  private checkoutPaidEvent(source: OwnerRecord, payment: any, payload: any):
    Pick<VerifiedWebhook, 'outbox' | 'receiptStatus' | 'receiptNote'> {
    const amount = Number(payment.attributes.amount);
    if (!source.referenceId) {
      return { receiptStatus: 'needs_reconciliation',
        receiptNote: 'Checkout owner has no merchant reference ID; no event was queued.' };
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return { receiptStatus: 'needs_reconciliation',
        receiptNote: 'Paid checkout amount is missing or invalid; no event was queued.' };
    }
    const createdAt = Number(payload.data.attributes?.created_at);
    return {
      receiptStatus: 'processed',
      outbox: {
        eventType: 'payment.checkout.paid',
        aggregateType: 'checkout',
        aggregateId: source.resourceId,
        ownerTribeId: source.tribeId,
        ownerProjectId: source.projectId,
        consumerServiceId: source.consumerServiceId,
        referenceId: source.referenceId,
        payload: {
          ownerTribeId: source.tribeId,
          ownerProjectId: source.projectId,
          consumerServiceId: source.consumerServiceId,
          referenceId: source.referenceId,
          occurredAt: new Date(Number.isFinite(createdAt) && createdAt > 0 ? createdAt * 1000 : Date.now()).toISOString(),
          checkoutId: source.resourceId,
          paymentId: payment.id,
          status: 'paid',
          amount,
          currency: String(payment.attributes.currency || 'PHP').toUpperCase(),
        },
      },
    };
  }
}
