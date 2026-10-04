import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { MemoryPaymentStore, assertTribeCanRead } from '../../shared/payment-store';
import { isMockMode, paymongoRequest, providerMode } from '../../shared/paymongo-client';
import { normalizeAmount } from './checkout.model';

export class CheckoutService {
  constructor(private readonly store = MemoryPaymentStore.getInstance()) {}

  async charge(chargeData: any, options: { idempotencyKey?: string; tribeId?: string } = {}) {
    const paymentMethodsAllowed = chargeData.paymentMethodsAllowed || ['card', 'gcash', 'paymaya'];
    const tribeId = options.tribeId || chargeData.tribeId;

    if (isMockMode()) {
      const checkoutId = toPublicId('chk', `mock_chk_${crypto.randomUUID().replace(/-/g, '')}`);
      const session = {
        checkoutId,
        provider: 'paymongo',
        status: 'pending',
        referenceId: chargeData.referenceId,
        redirectUrl: chargeData.successUrl || 'https://checkout.paymongo.local/mock',
        amount: chargeData.amount ? normalizeAmount(chargeData.amount, chargeData.currency) : { value: 10000, currency: 'PHP' },
        paymentMethodsAllowed,
        metadata: chargeData.metadata,
        createdAt: new Date().toISOString(),
      };

      await this.store.saveCheckoutSession({ ...session, tribeId });
      return session;
    }

    const body = {
      data: {
        attributes: {
          line_items: chargeData.lineItems || [{
            name: chargeData.description || chargeData.referenceId || 'Payment',
            amount: chargeData.amount,
            currency: chargeData.currency || 'PHP',
            quantity: 1,
          }],
          payment_method_types: paymentMethodsAllowed,
          success_url: chargeData.successUrl,
          cancel_url: chargeData.cancelUrl,
          description: chargeData.description,
          metadata: chargeData.metadata,
        },
      },
    };

    const response = await paymongoRequest('/checkout_sessions', {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};
    const checkoutId = toPublicId('chk', providerData.id || `chk_${crypto.randomUUID().replace(/-/g, '')}`);

    const session = {
      checkoutId,
      provider: 'paymongo',
      status: attributes.status || 'pending',
      referenceId: chargeData.referenceId,
      redirectUrl: attributes.checkout_url || chargeData.successUrl,
      expiresAt: attributes.expires_at ? new Date(attributes.expires_at * 1000).toISOString() : undefined,
      amount: chargeData.amount ? normalizeAmount(chargeData.amount, chargeData.currency) : { value: attributes.amount, currency: 'PHP' },
      paymentMethodsAllowed,
      metadata: chargeData.metadata,
      createdAt: new Date().toISOString(),
    };

    await this.store.saveCheckoutSession({ ...session, tribeId });
    return session;
  }

  async getCheckoutSession(checkoutId: string) {
    if (isMockMode()) {
      return {
        checkoutId,
        provider: 'paymongo',
        status: 'pending',
        redirectUrl: `https://checkout.paymongo.local/${checkoutId}`,
        createdAt: new Date().toISOString(),
      };
    }

    const response = await paymongoRequest(`/checkout_sessions/${encodeURIComponent(toProviderId('chk', checkoutId))}`);
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      checkoutId: toPublicId('chk', providerData.id || checkoutId),
      provider: 'paymongo',
      status: attributes.status || 'pending',
      redirectUrl: attributes.checkout_url,
      createdAt: new Date().toISOString(),
    };
  }

  async getCheckoutStatus(checkoutId: string, options: { tribeId?: string } = {}) {
    const stored = await this.store.getCheckoutSessionStatus(checkoutId);
    if (stored) {
      assertTribeCanRead(stored, options.tribeId);
      return stored;
    }
    return this.getCheckoutSession(checkoutId);
  }

  async getCheckoutStatusByReference(referenceId: string, options: { tribeId?: string } = {}) {
    if (!options.tribeId) {
      throw new PayMongoError('A tribe context is required to look up checkout status by reference.', 400);
    }
    const stored = await this.store.getCheckoutSessionByReference(referenceId, options.tribeId);
    if (stored) return stored;
    throw new PayMongoError(`Checkout session for reference '${referenceId}' was not found.`, 404);
  }

  async markCheckoutCancelled(checkoutId: string, options: { tribeId?: string; reason?: string; idempotencyKey?: string } = {}) {
    const current = await this.store.getCheckoutSessionStatus(checkoutId);
    const reason = options.reason || 'user_returned_from_cancel_url';
    if (current) assertTribeCanRead(current, options.tribeId);
    if (!isMockMode()) {
      await paymongoRequest(`/checkout_sessions/${encodeURIComponent(toProviderId('chk', checkoutId))}/expire`, {
        method: 'POST',
        idempotencyKey: options.idempotencyKey,
      });
    }
    const updated = await this.store.updateCheckoutStatus(checkoutId, { status: 'expired', cancellationReason: reason });
    return { ...(updated || current || {}), checkoutId, provider: 'paymongo', status: 'expired', reason };
  }
}
