import crypto from 'node:crypto';
import { toPublicId, toProviderId } from '../../shared/payment-ids';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';

export class CustomersCatalogService {
  async createCustomer(payload: any, options: { idempotencyKey?: string } = {}) {
    const { email, name, phone } = payload;
    if (!email) throw new PayMongoError('email is required', 400);

    if (isMockMode()) {
      return {
        customerId: toPublicId('cus', `cus_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        email,
        name: name || 'Mock Customer',
        phone,
      };
    }

    const response = await paymongoRequest('/customers', {
      method: 'POST',
      body: { data: { attributes: { email, name, phone } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      customerId: toPublicId('cus', providerData.id),
      email: attributes.email,
      name: attributes.name,
      phone: attributes.phone,
    };
  }

  async getCustomer(customerId: string) {
    if (isMockMode()) {
      return { customerId, email: 'customer@mock.local', name: 'Mock Customer' };
    }
    const response = await paymongoRequest(`/customers/${encodeURIComponent(toProviderId('cus', customerId))}`);
    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return {
      customerId: toPublicId('cus', providerData.id || customerId),
      email: attributes.email,
      name: attributes.name,
      phone: attributes.phone,
    };
  }

  async createProduct(payload: any, options: { idempotencyKey?: string } = {}) {
    const { name, description } = payload;
    if (!name) throw new PayMongoError('name is required', 400);
    return { productId: payload.productId || toPublicId('prd', `prod_${crypto.randomUUID().replace(/-/g, '')}`),
      name, description, active: payload.active ?? true, metadata: payload.metadata || {} };
  }

  async createPrice(payload: any, options: { idempotencyKey?: string } = {}) {
    const { amount, currency = 'PHP', productId, unitAmount, recurring } = payload;
    const finalAmount = typeof amount === 'object' ? Number(amount?.value) : Number(amount || unitAmount);
    if (!Number.isInteger(finalAmount) || finalAmount <= 0 || !productId || !recurring) {
      throw new PayMongoError('A positive amount, productId, and recurring interval are required', 400);
    }
    const interval = { week: 'weekly', month: 'monthly', year: 'yearly' }[recurring.interval as 'week' | 'month' | 'year'];
    if (!interval) throw new PayMongoError('PayMongo supports weekly, monthly, or yearly plans', 400);

    if (isMockMode()) {
      return { priceId: toPublicId('pri', `plan_mock_${crypto.randomUUID().replace(/-/g, '')}`),
        amount: { value: finalAmount, currency }, productId, recurring };
    }

    const response = await paymongoRequest('/subscriptions/plans', {
      method: 'POST',
      body: { data: { attributes: { name: payload.name || `Plan ${productId}`,
        amount: finalAmount, currency, interval, interval_count: recurring.intervalCount || 1 } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return { priceId: toPublicId('pri', providerData.id),
      amount: { value: attributes.amount || finalAmount, currency: attributes.currency || currency },
      productId, recurring };
  }
}
