import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

export class SubscriptionsService {
  async createSubscription(payload: any, options: { idempotencyKey?: string; tribeId?: string } = {}) {
    const { customerId, priceId } = payload;
    if (!customerId || !priceId) {
      throw new PayMongoError('customerId and priceId are required', 400);
    }

    if (isMockMode()) {
      return {
        subscriptionId: toPublicId('sub', `sub_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        status: 'active',
        customerId,
        priceId,
        createdAt: new Date().toISOString(),
      };
    }

    const response = await paymongoRequest('/subscriptions', {
      method: 'POST',
      body: { data: { attributes: { customer_id: toProviderId('cus', customerId), price_id: toProviderId('pri', priceId) } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      subscriptionId: toPublicId('sub', providerData.id),
      status: attributes.status || 'active',
      customerId,
      priceId,
      createdAt: new Date().toISOString(),
    };
  }

  async getSubscription(subscriptionId: string) {
    if (isMockMode()) {
      return { subscriptionId, status: 'active', createdAt: new Date().toISOString() };
    }
    const response = await paymongoRequest(`/subscriptions/${encodeURIComponent(toProviderId('sub', subscriptionId))}`);
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      subscriptionId: toPublicId('sub', providerData.id || subscriptionId),
      status: attributes.status,
      customerId: attributes.customer_id ? toPublicId('cus', attributes.customer_id) : undefined,
    };
  }

  async cancelSubscription(subscriptionId: string) {
    if (isMockMode()) {
      return { subscriptionId, status: 'cancelled' };
    }
    const response = await paymongoRequest(`/subscriptions/${encodeURIComponent(toProviderId('sub', subscriptionId))}/cancel`, { method: 'POST' });
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      subscriptionId: toPublicId('sub', providerData.id || subscriptionId),
      status: attributes.status || 'cancelled',
    };
  }
}
