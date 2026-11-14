import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

function nextAction(attributes: any) {
  const action = attributes?.next_action;
  const redirect = action?.redirect;
  if (action?.type !== 'redirect' || typeof redirect?.url !== 'string') return undefined;
  return { type: 'redirect', redirectUrl: redirect.url,
    ...(typeof redirect.return_url === 'string' ? { returnUrl: redirect.return_url } : {}) };
}

export class PaymentIntentsService {
  async createPaymentIntent(payload: any, options: { idempotencyKey?: string; tribeId?: string } = {}) {
    const { amount, currency = 'PHP', description, paymentMethodsAllowed = ['card', 'gcash', 'paymaya'] } = payload;
    if (!amount) throw new PayMongoError('amount is required', 400);

    if (isMockMode()) {
      return {
        paymentIntentId: toPublicId('pi', `pi_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        status: 'awaiting_payment_method',
        amount,
        currency,
        clientKey: `pi_mock_client_key_${Date.now()}`,
        paymentMethodsAllowed,
        description,
      };
    }

    const body = {
      data: {
        attributes: {
          amount,
          currency,
          description,
          payment_method_allowed: paymentMethodsAllowed,
        },
      },
    };

    const response = await paymongoRequest('/payment_intents', {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      paymentIntentId: toPublicId('pi', providerData.id),
      status: attributes.status,
      amount: attributes.amount,
      currency: attributes.currency,
      clientKey: attributes.client_key,
      nextAction: nextAction(attributes),
      paymentMethodsAllowed: attributes.payment_method_allowed,
      description: attributes.description,
    };
  }

  async getPaymentIntent(paymentIntentId: string) {
    if (isMockMode()) {
      return {
        paymentIntentId,
        status: 'succeeded',
        amount: 10000,
        currency: 'PHP',
      };
    }

    const response = await paymongoRequest(`/payment_intents/${encodeURIComponent(toProviderId('pi', paymentIntentId))}`);
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      paymentIntentId: toPublicId('pi', providerData.id || paymentIntentId),
      status: attributes.status,
      amount: attributes.amount,
      currency: attributes.currency,
      clientKey: attributes.client_key,
      nextAction: nextAction(attributes),
    };
  }

  async confirmPaymentIntent(paymentIntentId: string, payload: any, options: { idempotencyKey?: string } = {}) {
    if (isMockMode()) {
      return {
        paymentIntentId,
        status: 'succeeded',
        confirmedAt: new Date().toISOString(),
      };
    }

    const response = await paymongoRequest(`/payment_intents/${encodeURIComponent(toProviderId('pi', paymentIntentId))}/attach`, {
      method: 'POST',
      body: { data: { attributes: payload } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      paymentIntentId: toPublicId('pi', providerData.id || paymentIntentId),
      status: attributes.status,
      clientKey: attributes.client_key,
      nextAction: nextAction(attributes),
      confirmedAt: new Date().toISOString(),
    };
  }

  async cancelPaymentIntent(paymentIntentId: string, options: { idempotencyKey?: string } = {}) {
    if (isMockMode()) {
      return { paymentIntentId, status: 'cancelled' };
    }

    const response = await paymongoRequest(`/payment_intents/${encodeURIComponent(toProviderId('pi', paymentIntentId))}/cancel`, {
      method: 'POST',
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      paymentIntentId: toPublicId('pi', providerData.id || paymentIntentId),
      status: attributes.status || 'cancelled',
    };
  }
}
