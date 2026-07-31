import crypto from 'node:crypto';
import { PayMongoError } from '../../shared/payment-errors';

export class WebhooksService {
  async processWebhook(payload: any, options: { signatureHeader?: string } = {}) {
    const eventType = payload?.data?.attributes?.type || 'payment.paid';
    const resourceData = payload?.data?.attributes?.data || {};

    return {
      event: 'processed',
      data: {
        eventType,
        checkoutId: resourceData.id,
        paymentId: resourceData.attributes?.payment_intent_id || resourceData.id,
        updated: true,
      },
    };
  }
}
