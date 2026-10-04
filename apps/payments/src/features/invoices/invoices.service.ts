import { toProviderId, toPublicId } from '../../shared/payment-ids';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

function invoice(data: any) {
  const attributes = data?.attributes || {};
  return {
    invoiceId: toPublicId('inv', data.id),
    subscriptionId: attributes.resource_id || attributes.subscription_id,
    status: attributes.status === 'unpaid' ? 'open' : attributes.status || 'draft',
    amount: attributes.amount_due ?? attributes.amount ?? 0,
    currency: attributes.currency || 'PHP',
  };
}

/** Provides invoice reads through the shared payment provider client. */
export class InvoicesService {
  async listForSubscription(subscriptionId: string) {
    if (isMockMode()) return [];
    const resourceId = encodeURIComponent(toProviderId('sub', subscriptionId));
    const response = await paymongoRequest(`/subscriptions/invoices?resource_id=${resourceId}&limit=100`);
    return (Array.isArray(response?.data) ? response.data : []).map(invoice);
  }

  async get(invoiceId: string) {
    if (isMockMode()) return { invoiceId, status: 'draft', amount: 0, currency: 'PHP' };
    const response = await paymongoRequest(`/subscriptions/invoices/${encodeURIComponent(toProviderId('inv', invoiceId))}`);
    return invoice(response?.data);
  }
}
