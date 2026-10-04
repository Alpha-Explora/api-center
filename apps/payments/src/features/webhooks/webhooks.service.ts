import crypto from 'node:crypto';
import { PayMongoError } from '../../shared/payment-errors';
import { PaymentOwnerStore } from '../../shared/payment-owner-store';
import { toPublicId } from '../../shared/payment-ids';

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
    const eventType = payload?.data?.attributes?.type;
    const resourceData = payload?.data?.attributes?.data || {};
    if (payload?.data?.attributes?.livemode !== (environment === 'live')) {
      throw new PayMongoError('Webhook environment does not match payment', 403, 'ENVIRONMENT_MISMATCH');
    }
    let source;
    let payments: any[] = [];
    if (eventType === 'checkout_session.payment.paid' && resourceData.id?.startsWith('cs_')) {
      source = await this.owners.findWebhookSource('checkout', toPublicId('chk', resourceData.id), environment);
      payments = Array.isArray(resourceData.attributes?.payments) ? resourceData.attributes.payments : [];
    } else if (eventType === 'payment.paid' && resourceData.id?.startsWith('pay_')) {
      const intentId = resourceData.attributes?.payment_intent_id;
      if (typeof intentId === 'string' && intentId.startsWith('pi_')) {
        source = await this.owners.findWebhookSource('intent', intentId, environment);
        payments = [resourceData];
      }
    }
    if (!source) return { event: 'ignored', data: { eventType, updated: false } };
    let updated = 0;
    for (const payment of payments) {
      if (payment?.type !== 'payment' || typeof payment.id !== 'string' || !payment.id.startsWith('pay_')
        || payment.attributes?.status !== 'paid') continue;
      await this.owners.save({ ...source, resourceType: 'payment', resourceId: payment.id,
        snapshot: { paymentId: payment.id, status: 'paid', amount: payment.attributes.amount,
          currency: payment.attributes.currency, sourceId: source.resourceId } });
      updated++;
    }
    if (updated > 0) {
      const firstPayment = payments.find((payment) => payment?.attributes?.status === 'paid');
      await this.owners.save({ ...source, snapshot: { ...source.snapshot,
        status: eventType === 'payment.paid' ? 'succeeded' : 'paid',
        paymentId: firstPayment?.id } });
    }
    return { event: 'processed', data: { eventType, updated } };
  }
}
