import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import { paymongoRequest, stepIdempotencyKey } from '../../shared/paymongo-client';
import { SANDBOX_CONSUMER_ID, SANDBOX_MERCHANT_ID } from './account-events';
import type { ProviderAccountId } from './linked-account-lifecycle';
import type { ConsumerDetails, LinkedAccountsProvider, MerchantDetails, ProviderResult } from './linked-accounts-provider';

const created = z.object({ data: z.object({ id: z.union([z.literal(SANDBOX_MERCHANT_ID), z.literal(SANDBOX_CONSUMER_ID)]),
  type: z.enum(['merchant', 'consumer']) }) });
const expiresAt = z.union([
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  z.number().int().nonnegative().max(253_402_300_799).transform((value) => new Date(value * 1000)),
]);
const verification = z.object({ data: z.union([
  z.object({ id: z.string().min(1), url: z.url({ protocol: /^https$/ }), expired_at: expiresAt }),
  z.object({ id: z.string().min(1), attributes: z.object({
    hosted_url: z.url({ protocol: /^https$/ }), expired_at: expiresAt,
  }) }).transform(({ id, attributes }) => ({ id, url: attributes.hosted_url, expired_at: attributes.expired_at })),
]) });

const volumeBands = [
  [10_000_000, 'less_than_100K'],
  [30_000_001, 'between_100K_and_300K'],
  [50_000_001, 'between_300K_and_500K'],
  [100_000_001, 'between_500K_and_1M'],
  [300_000_001, 'between_1M_and_3M'],
] as const;

/** The Accounts sandbox returns a shared static reference and does not create a wallet. */
export class PayMongoLinkedAccountsSandbox implements LinkedAccountsProvider<MerchantDetails | ConsumerDetails> {
  constructor(private readonly request = paymongoRequest, private readonly kind: 'merchant' | 'consumer' = 'merchant') {}

  private get accountId() {
    return this.kind === 'merchant' ? SANDBOX_MERCHANT_ID : SANDBOX_CONSUMER_ID;
  }

  async create(reference: string) {
    const result = await this.call(() => this.request('/v2/accounts', {
      method: 'POST', body: { type: this.kind }, idempotencyKey: stepIdempotencyKey(reference, 'create'),
    }));
    if (result.kind !== 'ok') return result;
    const account = created.safeParse(result.value);
    if (!account.success || account.data.data.type !== this.kind || account.data.data.id !== this.accountId) {
      return { kind: 'unknown' as const };
    }
    return { kind: 'ok' as const, value: { providerAccountId: account.data.data.id } };
  }

  async findByReference(reference: string) {
    // The sandbox returns a static fixture, so repeating the test create cannot create another merchant.
    return this.create(reference);
  }

  async submitDetails(id: ProviderAccountId, details: MerchantDetails | ConsumerDetails) {
    if (!('representative' in details)) {
      return this.write(id, '', 'PATCH', 'details', {
        person: { first_name: details.firstName, last_name: details.lastName, email_address: details.email },
      }, JSON.stringify(details));
    }
    return this.write(id, '', 'PATCH', 'details', {
      person: { first_name: details.representative.firstName, last_name: details.representative.lastName,
        email_address: details.representative.email },
      business: { trade_name: details.businessName, tin: details.tin,
        estimated_monthly_volume: volumeBands.find(([upper]) => details.expectedMonthlyVolume < upper)?.[1] ?? 'greater_than_3M' },
    }, JSON.stringify(details));
  }

  async issueVerificationLink(id: ProviderAccountId, requestKey: string) {
    if (id !== this.accountId) return { kind: 'unknown' as const };
    const result = await this.call(() => this.request(`/v2/accounts/${id}/identity_verification`, {
      method: 'POST', idempotencyKey: stepIdempotencyKey(requestKey, 'verification'),
    }));
    if (result.kind !== 'ok') return result;
    const link = verification.safeParse(result.value);
    if (!link.success) return { kind: 'unknown' as const };
    return { kind: 'ok' as const, value: { url: link.data.data.url, expiresAt: link.data.data.expired_at,
      sessionId: link.data.data.id } };
  }

  activate(id: ProviderAccountId) {
    return this.write(id, '/activate', 'POST', 'activate', {});
  }

  async requestPaymentMethods(): Promise<ProviderResult<void>> {
    return { kind: 'rejected', code: 'capabilities_unavailable', message: 'The static sandbox account cannot be provisioned' };
  }

  private async write(id: ProviderAccountId, suffix: string, method: string, key: string, body: unknown,
    identity: string = id): Promise<ProviderResult<void>> {
    if (id !== this.accountId) return { kind: 'unknown' };
    const response = await this.call(() => this.request(`/v2/accounts/${id}${suffix}`, {
      method, body, idempotencyKey: stepIdempotencyKey(identity, key),
    }));
    return response.kind === 'ok' ? { kind: 'ok', value: undefined } : response;
  }

  private async call(action: () => Promise<unknown>): Promise<ProviderResult<unknown>> {
    try {
      return { kind: 'ok', value: await action() };
    } catch (error) {
      const status = error instanceof PayMongoError ? error.providerStatus ?? error.statusCode : 0;
      if (error instanceof PayMongoError && status >= 400 && status < 500 && status !== 408 && status !== 409) {
        return { kind: 'rejected', code: status === 429 ? 'rate_limited' : error.code,
          message: 'The payment provider rejected the account operation' };
      }
      return { kind: 'unknown' };
    }
  }
}
