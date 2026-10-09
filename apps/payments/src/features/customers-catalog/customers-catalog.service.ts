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

  async createPlan(payload: any, options: { idempotencyKey?: string } = {}) {
    const { name, description, amount, currency = 'PHP', interval, intervalCount = 1, cycleCount, metadata } = payload;
    if (typeof name !== 'string' || !name.trim()) throw new PayMongoError('name is required', 400);
    if (!Number.isSafeInteger(amount) || amount < 2000) {
      throw new PayMongoError('amount must be an integer of at least 2000 centavos', 400);
    }
    if (currency !== 'PHP') throw new PayMongoError('Only PHP plans are supported', 400);
    if (!['weekly', 'monthly', 'yearly'].includes(interval)) {
      throw new PayMongoError('interval must be weekly, monthly, or yearly', 400);
    }
    if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 10) {
      throw new PayMongoError('intervalCount must be an integer from 1 to 10', 400);
    }
    if (cycleCount !== undefined && (!Number.isSafeInteger(cycleCount) || cycleCount < 2)) {
      throw new PayMongoError('cycleCount must be an integer of at least 2', 400);
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
      throw new PayMongoError('description must be a string of at most 1000 characters', 400);
    }
    if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || Object.values(metadata).some((value) => typeof value !== 'string'))) {
      throw new PayMongoError('metadata values must be strings', 400);
    }

    const attributes = {
      name: name.trim(), description, amount, currency, interval,
      interval_count: intervalCount, ...(cycleCount === undefined ? {} : { cycle_count: cycleCount }), metadata,
    };
    const response = isMockMode()
      ? { data: { id: `plan_mock_${crypto.randomUUID().replace(/-/g, '')}`, attributes } }
      : await paymongoRequest('/subscriptions/plans', {
        method: 'POST', body: { data: { attributes } }, idempotencyKey: options.idempotencyKey,
      });
    return this.planView(response?.data || {});
  }

  async getPlan(planId: string) {
    if (isMockMode()) {
      return this.planView({ id: planId, attributes: { name: 'Mock Plan', amount: 2000,
        currency: 'PHP', interval: 'monthly', interval_count: 1 } });
    }
    const response = await paymongoRequest(`/subscriptions/plans/${encodeURIComponent(planId)}`);
    return this.planView(response?.data || {});
  }

  private planView(resource: any) {
    const attributes = resource.attributes || {};
    return {
      planId: resource.id,
      name: attributes.name,
      description: attributes.description,
      amount: attributes.amount,
      currency: attributes.currency || 'PHP',
      interval: attributes.interval,
      intervalCount: attributes.interval_count,
      cycleCount: attributes.cycle_count,
      metadata: attributes.metadata || {},
    };
  }
}
