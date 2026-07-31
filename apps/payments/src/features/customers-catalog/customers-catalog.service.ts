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

    if (isMockMode()) {
      return { productId: toPublicId('prd', `prod_mock_${crypto.randomUUID().replace(/-/g, '')}`), name, description };
    }

    const response = await paymongoRequest('/products', {
      method: 'POST',
      body: { data: { attributes: { name, description } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return { productId: toPublicId('prd', providerData.id), name: attributes.name, description: attributes.description };
  }

  async createPrice(payload: any, options: { idempotencyKey?: string } = {}) {
    const { amount, currency = 'PHP', productId, unitAmount } = payload;
    const finalAmount = amount || unitAmount;
    if (!finalAmount || !productId) throw new PayMongoError('amount and productId are required', 400);

    if (isMockMode()) {
      return { priceId: toPublicId('pri', `price_mock_${crypto.randomUUID().replace(/-/g, '')}`), amount: finalAmount, currency, productId };
    }

    const response = await paymongoRequest('/prices', {
      method: 'POST',
      body: { data: { attributes: { unit_amount: finalAmount, currency, product_id: toProviderId('prd', productId) } } },
      idempotencyKey: options.idempotencyKey,
    });

    const providerData = response?.data || {};
    const attributes = providerData.attributes || {};

    return { priceId: toPublicId('pri', providerData.id), amount: attributes.unit_amount, currency: attributes.currency, productId };
  }
}
