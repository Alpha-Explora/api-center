import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

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
      body: { data: { attributes: { amount, payment_id: toProviderId('pi', paymentId), reason, notes } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      refundId: toPublicId('ref', providerData.id),
      status: attributes.status || 'succeeded',
      amount: attributes.amount,
      paymentId,
      reason: attributes.reason,
      createdAt: new Date().toISOString(),
    };
  }
}
