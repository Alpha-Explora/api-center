import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

export class SubscriptionsService {
  async createSubscription(payload: any, options: { idempotencyKey?: string; tribeId?: string } = {}) {
    const { customerId, planId } = payload;
    if (!customerId || !planId) {
      throw new PayMongoError('customerId and planId are required', 400);
    }
    if (payload.cancelAtPeriodEnd === true) {
      throw new PayMongoError('Scheduled cancellation is not supported by this provider', 422, 'UNSUPPORTED_OPTION');
    }

    if (isMockMode()) {
      return {
        subscriptionId: toPublicId('sub', `sub_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        status: 'pending',
        customerId,
        planId,
        createdAt: new Date().toISOString(),
      };
    }

    const response = await paymongoRequest('/subscriptions', {
      method: 'POST',
      body: { data: { attributes: { customer_id: toProviderId('cus', customerId), plan_id: planId } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      subscriptionId: toPublicId('sub', providerData.id),
      status: attributes.status === 'incomplete' ? 'pending' : attributes.status || 'pending',
      customerId,
      planId,
      currentPeriodEnd: attributes.next_billing_schedule,
      createdAt: new Date().toISOString(),
    };
  }

  async getSubscription(subscriptionId: string) {
    if (isMockMode()) {
      return { subscriptionId, status: 'pending', createdAt: new Date().toISOString() };
    }
    const response = await paymongoRequest(`/subscriptions/${encodeURIComponent(toProviderId('sub', subscriptionId))}`);
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      subscriptionId: toPublicId('sub', providerData.id || subscriptionId),
      status: attributes.status === 'incomplete' ? 'pending' : attributes.status,
      customerId: attributes.customer_id ? toPublicId('cus', attributes.customer_id) : undefined,
      planId: attributes.plan_id,
      currentPeriodEnd: attributes.next_billing_schedule,
    };
  }

  async cancelSubscription(subscriptionId: string, options: { idempotencyKey?: string } = {}) {
    if (isMockMode()) {
      return { subscriptionId, status: 'cancelled' };
    }
    const response = await paymongoRequest(`/subscriptions/${encodeURIComponent(toProviderId('sub', subscriptionId))}/cancel`, {
      method: 'POST', idempotencyKey: options.idempotencyKey,
    });
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      subscriptionId: toPublicId('sub', providerData.id || subscriptionId),
      status: attributes.status || 'cancelled',
    };
  }
}
