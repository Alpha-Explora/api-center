import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ProviderAccountId } from './linked-account-lifecycle';

export const merchantDetailsInput = z.object({
  businessName: z.string().trim().min(1).max(200),
  tin: z.string().trim().min(1).max(32),
  expectedMonthlyVolume: z.number().int().nonnegative(),
  representative: z.object({
    email: z.email(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

export type MerchantDetails = z.infer<typeof merchantDetailsInput>;
export const consumerDetailsInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.email(),
}).strict();
export type ConsumerDetails = z.infer<typeof consumerDetailsInput>;
export type ProviderResult<T> = { kind: 'ok'; value: T }
  | { kind: 'rejected'; code: string; message: string; retryAfter?: number }
  | { kind: 'unknown' };

export type VerificationLink = { url: string; expiresAt: Date; sessionId: string };

export interface LinkedAccountsProvider<Details = MerchantDetails> {
  create(reference: string): Promise<ProviderResult<{ providerAccountId: ProviderAccountId }>>;
  findByReference(reference: string): Promise<ProviderResult<{ providerAccountId: ProviderAccountId } | null>>;
  submitDetails(id: ProviderAccountId, details: Details): Promise<ProviderResult<void>>;
  issueVerificationLink(id: ProviderAccountId, requestKey: string): Promise<ProviderResult<VerificationLink>>;
  activate(id: ProviderAccountId): Promise<ProviderResult<void>>;
  requestPaymentMethods(id: ProviderAccountId): Promise<ProviderResult<void>>;
}

export class FakeLinkedAccountsProvider implements LinkedAccountsProvider {
  private readonly created = new Set<string>();
  private readonly sessions = new Map<string, VerificationLink>();
  private readonly now: () => Date;

  constructor(now = () => new Date()) {
    this.now = now;
  }

  private account(reference: string): { providerAccountId: ProviderAccountId } {
    return { providerAccountId: `org_${createHash('sha256').update(reference).digest('hex').slice(0, 24)}` };
  }

  async create(reference: string) {
    this.created.add(reference);
    return { kind: 'ok' as const, value: this.account(reference) };
  }

  async findByReference(reference: string) {
    return { kind: 'ok' as const, value: this.created.has(reference) ? this.account(reference) : null };
  }

  async submitDetails() { return { kind: 'ok' as const, value: undefined }; }

  async issueVerificationLink(id: ProviderAccountId, requestKey: string) {
    const sessionId = `verif_${createHash('sha256').update(JSON.stringify([id, requestKey])).digest('hex').slice(0, 24)}`;
    const link = this.sessions.get(sessionId) ?? {
      sessionId, url: `https://identity.paymongo.example/v/${sessionId}`,
      expiresAt: new Date(this.now().getTime() + 72 * 60 * 60 * 1000),
    };
    this.sessions.set(sessionId, link);
    return { kind: 'ok' as const, value: link };
  }

  async activate() { return { kind: 'ok' as const, value: undefined }; }

  async requestPaymentMethods() { return { kind: 'ok' as const, value: undefined }; }
}
