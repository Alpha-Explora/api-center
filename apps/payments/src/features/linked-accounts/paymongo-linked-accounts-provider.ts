import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import { paymongoRequest, stepIdempotencyKey } from '../../shared/paymongo-client';
import { SANDBOX_MERCHANT_ID } from './account-events';
import type { ProviderAccountId } from './linked-account-lifecycle';
import type { LinkedAccountsProvider, MerchantDetails, ProviderResult } from './linked-accounts-provider';

const created = z.object({ data: z.object({ id: z.literal(SANDBOX_MERCHANT_ID), type: z.literal('merchant') }) });
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
export class PayMongoLinkedAccountsSandbox implements LinkedAccountsProvider {
  constructor(private readonly request = paymongoRequest) {}

  async create(reference: string) {
    const result = await this.call(() => this.request('/v2/accounts', {
      method: 'POST', body: { type: 'merchant' }, idempotencyKey: stepIdempotencyKey(reference, 'create'),
    }));
    if (result.kind !== 'ok') return result;
    const account = created.safeParse(result.value);
    if (!account.success) return { kind: 'unknown' as const };
    return { kind: 'ok' as const, value: { providerAccountId: account.data.data.id } };
  }

  async findByReference() {
    // The sandbox does not persist accounts or expose a reference search.
    return { kind: 'ok' as const, value: null };
  }

  async submitDetails(id: ProviderAccountId, details: MerchantDetails) {
    return this.write(id, '', 'PATCH', 'details', {
      person: { first_name: details.representative.firstName, last_name: details.representative.lastName,
        email_address: details.representative.email },
      business: { trade_name: details.businessName, tin: details.tin,
        estimated_monthly_volume: volumeBands.find(([upper]) => details.expectedMonthlyVolume < upper)?.[1] ?? 'greater_than_3M' },
    }, JSON.stringify(details));
  }

  async issueVerificationLink(id: ProviderAccountId, requestKey: string) {
    if (id !== SANDBOX_MERCHANT_ID) return { kind: 'unknown' as const };
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
    if (id !== SANDBOX_MERCHANT_ID) return { kind: 'unknown' };
    const response = await this.call(() => this.request(`/v2/accounts/${id}${suffix}`, {
      method, body, idempotencyKey: stepIdempotencyKey(identity, key),
    }));
    return response.kind === 'ok' ? { kind: 'ok', value: undefined } : response;
  }

  private async call(action: () => Promise<unknown>): Promise<ProviderResult<unknown>> {
    try {
      return { kind: 'ok', value: await action() };
    } catch (error) {
      if (error instanceof PayMongoError && error.statusCode >= 400 && error.statusCode < 500
        && error.statusCode !== 408 && error.statusCode !== 409) {
        return { kind: 'rejected', code: error.statusCode === 429 ? 'rate_limited' : error.code,
          message: 'PayMongo rejected the sandbox operation' };
      }
      return { kind: 'unknown' };
    }
  }
}
