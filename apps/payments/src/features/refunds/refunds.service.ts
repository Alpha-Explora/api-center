import crypto from 'node:crypto';
import type { RefundStatus } from '@alpha-explora/apicenter-contracts';
import { toProviderId, toPublicId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

const refundStatuses: ReadonlySet<string> = new Set(['pending', 'processing', 'succeeded', 'failed']);

/** Narrows provider input to a status recognized by the public refund contract. */
export function isRefundStatus(status: unknown): status is RefundStatus {
  return typeof status === 'string' && refundStatuses.has(status);
}

export class RefundsService {
  async refund(payload: any, options: { idempotencyKey?: string; tribeId?: string } = {}) {
    const { amount, paymentId, reason = 'requested_by_customer', notes } = payload;
    if (!amount || !paymentId) throw new PayMongoError('amount and paymentId are required', 400);

    if (isMockMode()) {
      return {
        refundId: toPublicId('ref', `ref_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        status: 'succeeded',
        amount,
        paymentId,
        reason,
        createdAt: new Date().toISOString(),
      };
    }

    const response = await paymongoRequest('/refunds', {
      method: 'POST',
      body: { data: { attributes: { amount, payment_id: paymentId, reason, notes } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      refundId: toPublicId('ref', providerData.id),
      status: attributes.status || 'succeeded',
      amount: attributes.amount,
      paymentId: attributes.payment_id ? toPublicId('pay', attributes.payment_id) : paymentId,
      currency: attributes.currency,
      reason: attributes.reason,
      createdAt: attributes.created_at ? new Date(attributes.created_at * 1000).toISOString() : new Date().toISOString(),
      ...(attributes.updated_at ? { updatedAt: new Date(attributes.updated_at * 1000).toISOString() } : {}),
    };
  }

  async getRefund(refundId: string) {
    if (isMockMode()) {
      throw new PayMongoError('Refund retrieval is unavailable in mock mode', 503, 'MOCK_PROVIDER_UNAVAILABLE');
    }

    const providerId = toProviderId('ref', refundId);
    const response = await paymongoRequest(`/refunds/${encodeURIComponent(providerId)}`);
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};
    if (providerData.id !== providerId) {
      throw new PayMongoError('PayMongo returned a different refund', 502, 'PROVIDER_RESOURCE_MISMATCH');
    }
    if (!isRefundStatus(attributes.status)) {
      throw new PayMongoError('PayMongo returned an unsupported refund status', 502, 'INVALID_PROVIDER_RESPONSE');
    }

    return {
      refundId: toPublicId('ref', providerData.id),
      status: attributes.status,
      amount: attributes.amount,
      paymentId: attributes.payment_id ? toPublicId('pay', attributes.payment_id) : undefined,
      currency: attributes.currency,
      reason: attributes.reason,
      createdAt: attributes.created_at ? new Date(attributes.created_at * 1000).toISOString() : undefined,
      updatedAt: attributes.updated_at ? new Date(attributes.updated_at * 1000).toISOString() : undefined,
    };
  }
}
