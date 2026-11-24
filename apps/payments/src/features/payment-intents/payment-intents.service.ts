import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest, stepIdempotencyKey, type PayMongoAccount } from '../../shared/paymongo-client';

const WALLETS = new Set(['gcash', 'paymaya']);
type PayMongoCall = typeof paymongoRequest;

function nextAction(attributes: any) {
  const action = attributes?.next_action;
  const redirect = action?.redirect;
  if (action?.type !== 'redirect' || typeof redirect?.url !== 'string') return undefined;
  return { type: 'redirect', redirectUrl: redirect.url,
    ...(typeof redirect.return_url === 'string' ? { returnUrl: redirect.return_url } : {}) };
}

/**
 * A failed attempt sends a PayMongo intent back to awaiting_payment_method with last_payment_error set.
 * APICenter reports that as failed: the attempt the customer made did not go through.
 */
function intentStatus(attributes: any): { status: string; lastPaymentError?: { code?: string; message?: string } } {
  const error = attributes?.last_payment_error;
  if (attributes?.status === 'awaiting_payment_method' && error) {
    return { status: 'failed', lastPaymentError: {
      ...(typeof error.failed_code === 'string' ? { code: error.failed_code } : typeof error.code === 'string' ? { code: error.code } : {}),
      ...(typeof error.failed_message === 'string' ? { message: error.failed_message }
        : typeof error.message === 'string' ? { message: error.message } : {}) } };
  }
  return { status: attributes?.status };
}

function billingDetails(billing: any) {
  if (!billing || typeof billing !== 'object') return undefined;
  const details = Object.fromEntries(['name', 'email', 'phone']
    .filter((field) => typeof billing[field] === 'string' && billing[field])
    .map((field) => [field, billing[field]]));
  return Object.keys(details).length ? details : undefined;
}

export class PaymentIntentsService {
  constructor(private readonly request: PayMongoCall = paymongoRequest,
    private readonly mockMode: () => boolean = isMockMode) {}

  async createPaymentIntent(payload: any, options: { idempotencyKey?: string; tribeId?: string; account?: PayMongoAccount } = {}) {
    if (payload?.paymentMethod !== undefined) return this.createWalletPaymentIntent(payload, options.idempotencyKey, options.account);
    const { amount, currency = 'PHP', description, paymentMethodsAllowed = ['card', 'gcash', 'paymaya'] } = payload;
    if (!amount) throw new PayMongoError('amount is required', 400);

    if (this.mockMode()) {
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

    const response = await this.request('/payment_intents', {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey,
      ...(options.account ? { account: options.account } : {}),
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

  /**
   * Creates the intent, the wallet payment method and the attachment in one call, so the customer goes
   * straight from the app to GCash or Maya. Each step has its own idempotency key; a retried request
   * repeats each step once and returns the same redirect.
   */
  async createWalletPaymentIntent(payload: any, idempotencyKey?: string, account?: PayMongoAccount) {
    const { amount, currency = 'PHP', description, referenceId, paymentMethod, returnUrl, billing } = payload || {};
    if (!Number.isSafeInteger(amount) || amount < 100) {
      throw new PayMongoError('amount must be an integer of at least 100 centavos', 400, 'INVALID_AMOUNT');
    }
    if (currency !== 'PHP') throw new PayMongoError('currency must be PHP', 400, 'INVALID_CURRENCY');
    if (!referenceId || typeof referenceId !== 'string') throw new PayMongoError('referenceId is required', 400, 'INVALID_REFERENCE');
    if (!WALLETS.has(paymentMethod)) throw new PayMongoError('paymentMethod must be gcash or paymaya', 400, 'INVALID_PAYMENT_METHOD');
    if (!returnUrl || typeof returnUrl !== 'string') throw new PayMongoError('returnUrl is required', 400, 'INVALID_RETURN_URL');

    if (this.mockMode()) {
      return { paymentIntentId: toPublicId('pi', `pi_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        referenceId, status: 'awaiting_next_action', amount, currency, paymentMethod,
        nextAction: { type: 'redirect', redirectUrl: `https://pm.link/mock/${paymentMethod}`, returnUrl } };
    }

    const intentResponse = await this.request('/payment_intents', { method: 'POST', ...(account ? { account } : {}),
      idempotencyKey: stepIdempotencyKey(idempotencyKey, 'intent'),
      body: { data: { attributes: { amount, currency, description, payment_method_allowed: [paymentMethod],
        metadata: { referenceId } } } } });
    const intent = intentResponse?.data || {};
    if (!intent.id || !intent.attributes?.client_key) {
      throw new PayMongoError('PayMongo did not return the intent client key', 502, 'INVALID_PROVIDER_RESPONSE');
    }
    const details = billingDetails(billing);
    const methodResponse = await this.request('/payment_methods', { method: 'POST', ...(account ? { account } : {}),
      idempotencyKey: stepIdempotencyKey(idempotencyKey, 'method'),
      body: { data: { attributes: { type: paymentMethod, ...(details ? { billing: details } : {}) } } } });
    const paymentMethodId = methodResponse?.data?.id;
    if (!paymentMethodId) throw new PayMongoError('PayMongo did not return a wallet payment method', 502, 'INVALID_PROVIDER_RESPONSE');
    const attachedResponse = await this.request(`/payment_intents/${encodeURIComponent(intent.id)}/attach`, {
      method: 'POST', ...(account ? { account } : {}), idempotencyKey: stepIdempotencyKey(idempotencyKey, 'attach'),
      body: { data: { attributes: { payment_method: paymentMethodId, client_key: intent.attributes.client_key,
        return_url: returnUrl } } } });
    const attached = attachedResponse?.data || intent;
    const attributes = attached.attributes || {};
    const action = nextAction(attributes);
    if (!action) throw new PayMongoError('PayMongo did not return a wallet redirect', 502, 'INVALID_PROVIDER_RESPONSE');
    return { paymentIntentId: toPublicId('pi', attached.id || intent.id), referenceId,
      ...intentStatus(attributes), amount: attributes.amount ?? amount, currency: attributes.currency || currency,
      paymentMethod, nextAction: action };
  }

  async getPaymentIntent(paymentIntentId: string, account?: PayMongoAccount) {
    if (this.mockMode()) {
      return {
        paymentIntentId,
        status: 'succeeded',
        amount: 10000,
        currency: 'PHP',
      };
    }

    const response = await this.request(`/payment_intents/${encodeURIComponent(toProviderId('pi', paymentIntentId))}`, { account });
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      paymentIntentId: toPublicId('pi', providerData.id || paymentIntentId),
      ...intentStatus(attributes),
      amount: attributes.amount,
      currency: attributes.currency,
      clientKey: attributes.client_key,
      nextAction: nextAction(attributes),
    };
  }

  async confirmPaymentIntent(paymentIntentId: string, payload: any, options: { idempotencyKey?: string; account?: PayMongoAccount } = {}) {
    if (this.mockMode()) {
      return {
        paymentIntentId,
        status: 'succeeded',
        confirmedAt: new Date().toISOString(),
      };
    }

    const response = await this.request(`/payment_intents/${encodeURIComponent(toProviderId('pi', paymentIntentId))}/attach`, {
      method: 'POST',
      body: { data: { attributes: payload } },
      idempotencyKey: options.idempotencyKey,
      ...(options.account ? { account: options.account } : {}),
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

  async cancelPaymentIntent(paymentIntentId: string, options: { idempotencyKey?: string; account?: PayMongoAccount } = {}) {
    if (this.mockMode()) {
      return { paymentIntentId, status: 'cancelled' };
    }

    const response = await this.request(`/payment_intents/${encodeURIComponent(toProviderId('pi', paymentIntentId))}/cancel`, {
      method: 'POST',
      idempotencyKey: options.idempotencyKey,
      ...(options.account ? { account: options.account } : {}),
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      paymentIntentId: toPublicId('pi', providerData.id || paymentIntentId),
      status: attributes.status || 'cancelled',
    };
  }
}
