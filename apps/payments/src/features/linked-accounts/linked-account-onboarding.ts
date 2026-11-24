import type { PoolClient } from 'pg';
import { PayMongoError } from '../../shared/payment-errors';
import type { PaymentContext } from '../../shared/payment-owner-store';
import { SANDBOX_MERCHANT_ID, type AccountEvent } from './account-events';
import { lookupChildWallet } from './child-wallet';
import { applyEvent, nextAction, type LifecycleEvent, type LinkedAccountStatus, type NextAction } from './linked-account-lifecycle';
import { LinkedAccountStore, type LinkedAccountRecord } from './linked-account-store';
import type { LinkedAccountsSwitch } from './linked-accounts-switch';
import type { LinkedAccountsProvider, MerchantDetails, ProviderResult, VerificationLink } from './linked-accounts-provider';

export type OnboardingView = {
  id: string;
  status: LinkedAccountStatus;
  nextAction: NextAction;
  attempts: number;
  walletOnly: boolean;
  declineReason: string | null;
  verification: { url: string; expiresAt: string } | null;
};

function unwrap<T>(result: ProviderResult<T>): T {
  if (result.kind === 'ok') return result.value;
  if (result.kind === 'unknown') throw new PayMongoError('The account operation needs provider reconciliation', 503, 'LINKED_ACCOUNT_OUTCOME_UNKNOWN');
  if (result.code === 'rate_limited') {
    throw new PayMongoError('PayMongo rate limited this account operation', 429, 'PROVIDER_RATE_LIMITED',
      { retryAfter: result.retryAfter ?? 30 });
  }
  throw new PayMongoError('PayMongo declined the account operation', 422, 'LINKED_ACCOUNT_PROVIDER_REJECTED');
}

export class LinkedAccountOnboarding {
  constructor(private readonly store: LinkedAccountStore, readonly switches: LinkedAccountsSwitch,
    private readonly provider: LinkedAccountsProvider | null, private readonly now = () => new Date(),
    private readonly hasChildWebhook = (_accountId: string) => false) {}

  get providerAvailable(): boolean {
    return this.provider !== null;
  }

  async status(context: PaymentContext) {
    const record = await this.store.current(context);
    return {
      environmentEnabled: this.switches.environmentEnabled(),
      projectEnabled: await this.switches.projectEnabled(context.environment, context.projectId),
      onboarding: record ? this.view(record) : null,
      providerAvailable: this.providerAvailable,
      collectionMoveAvailable: Boolean(record?.providerAccountId
        && record.providerAccountId !== SANDBOX_MERCHANT_ID && this.hasChildWebhook(record.providerAccountId)),
    };
  }

  async current(context: PaymentContext) {
    const record = await this.store.current(context);
    return record ? this.view(record) : null;
  }

  async start(context: PaymentContext, details: MerchantDetails) {
    await this.switches.assertEnabledFor(context.environment, context.projectId);
    const provider = this.requireProvider();
    const id = await this.ensureCreated(context, provider);
    await this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.owned(context, id, query);
      if (record.status === 'created' && record.providerAccountId) {
        unwrap(await provider.submitDetails(record.providerAccountId, details));
        await this.update(record, { type: 'details_submitted' }, query);
      }
    });
    return this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.owned(context, id, query);
      if (record.status === 'details_submitted' && record.providerAccountId) {
        const link = unwrap(await provider.issueVerificationLink(record.providerAccountId, `${record.id}:initial`));
        return this.recordLink(record, link, query);
      }
      return this.view(record);
    });
  }

  private async ensureCreated(context: PaymentContext, provider: LinkedAccountsProvider): Promise<string> {
    const { id, action } = await this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.store.open(context, query);
      if (record.status !== 'draft') return { id: record.id, action: 'continue' as const };
      if (record.createStartedAt) return { id: record.id, action: 'reconcile' as const };
      // Commit the reference and dispatch claim before contacting PayMongo.
      await this.store.save({ ...record, createStartedAt: this.now() }, query);
      return { id: record.id, action: 'create' as const };
    });
    if (action === 'continue') return id;

    const outcome = action === 'create' ? await provider.create(id) : await provider.findByReference(id);
    await this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.owned(context, id, query);
      if (record.status !== 'draft') return;
      if (outcome.kind === 'ok' && outcome.value) {
        await this.update(record, { type: 'created', providerAccountId: outcome.value.providerAccountId }, query);
      } else if (action === 'create' && outcome.kind === 'rejected') {
        await this.store.save({ ...record, createStartedAt: null }, query);
      }
    });
    if (!unwrap(outcome)) unwrap({ kind: 'unknown' });
    return id;
  }

  async reissueVerificationLink(context: PaymentContext, id: string, requestKey: string) {
    await this.switches.assertEnabledFor(context.environment, context.projectId);
    const provider = this.requireProvider();
    return this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.owned(context, id, query);
      if (record.status === 'manual_review') {
        throw new PayMongoError('Verification attempts are exhausted', 409, 'VERIFICATION_ATTEMPTS_EXHAUSTED');
      }
      if (!record.providerAccountId || !['details_submitted', 'verification_pending', 'verification_failed'].includes(record.status)) {
        throw this.invalidState();
      }
      const link = unwrap(await provider.issueVerificationLink(record.providerAccountId, requestKey));
      return this.recordLink(record, link, query);
    });
  }

  async advance(context: PaymentContext, id: string) {
    await this.switches.assertEnabledFor(context.environment, context.projectId);
    const provider = this.requireProvider();
    return this.store.lock(context.environment, context.projectId, async (query) => {
      let record = await this.owned(context, id, query);
      if (!record.providerAccountId) return this.view(record);
      const action = nextAction(record, this.now());
      if (action === 'activate') {
        unwrap(await provider.activate(record.providerAccountId));
        record = record.providerAccountId === SANDBOX_MERCHANT_ID
          ? await this.update(record, { type: 'activated', wallet: null }, query)
          : await this.update(record, { type: 'activation_requested' }, query);
      } else if (action === 'request_payment_methods' && record.providerAccountId !== SANDBOX_MERCHANT_ID) {
        unwrap(await provider.requestPaymentMethods(record.providerAccountId));
        record = await this.update(record, { type: 'payment_methods_requested' }, query);
      }
      return this.view(record);
    });
  }

  applyProviderEvent(environment: PaymentContext['environment'], event: AccountEvent) {
    return this.store.applyProviderEvent(environment, event);
  }

  async moveProject(context: PaymentContext, id: string, target: 'child' | 'parent') {
    let discoveredWallet: Awaited<ReturnType<typeof lookupChildWallet>> = null;
    if (target === 'child') {
      await this.switches.assertEnabledFor(context.environment, context.projectId);
      this.requireProvider();
      const record = await this.owned(context, id);
      const accountId = this.movableAccount(record);
      discoveredWallet = await this.store.hasWallet(record) ? null : await lookupChildWallet(accountId, context.environment);
    }
    await this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.owned(context, id, query);
      if (target === 'child') {
        await this.store.move(record, this.movableAccount(record), query, discoveredWallet);
      } else {
        await this.store.move(record, 'parent', query);
      }
    });
  }

  private movableAccount(record: LinkedAccountRecord) {
    const accountId = record.providerAccountId;
    if (record.status !== 'active' || !accountId || accountId === SANDBOX_MERCHANT_ID || record.walletOnly) {
      throw this.invalidState();
    }
    if (!this.hasChildWebhook(accountId)) {
      throw new PayMongoError('Configure the child payment webhook before moving collections', 409, 'CHILD_WEBHOOK_NOT_CONFIGURED');
    }
    return accountId;
  }

  async close(context: PaymentContext, id: string) {
    await this.store.lock(context.environment, context.projectId, async (query) => {
      const record = await this.owned(context, id, query);
      await this.store.close(record, query);
    });
  }

  private async owned(context: PaymentContext, id: string, query?: PoolClient) {
    const record = await this.store.current(context, query);
    if (!record || record.id !== id) throw new PayMongoError('Linked account not found', 404, 'LINKED_ACCOUNT_NOT_FOUND');
    return record;
  }

  private async update(record: LinkedAccountRecord, event: LifecycleEvent, query?: PoolClient) {
    const next = { ...record, ...applyEvent(record, event) };
    await this.store.save(next, query);
    return next;
  }

  private async recordLink(record: LinkedAccountRecord, link: VerificationLink, query?: PoolClient) {
    if (!await this.store.addVerificationSession(record, link.sessionId, query)) return this.view(record);
    const updated = await this.update({ ...record, verificationSessionId: link.sessionId },
      { type: 'verification_link_issued', expiresAt: link.expiresAt }, query);
    return this.view(updated, link);
  }

  private view(record: LinkedAccountRecord, link?: VerificationLink): OnboardingView {
    const action = nextAction(record, this.now());
    return { id: record.id, status: record.status,
      nextAction: action === 'request_payment_methods' && record.providerAccountId === SANDBOX_MERCHANT_ID ? 'none' : action,
      attempts: record.attempts,
      walletOnly: record.walletOnly, declineReason: record.declineReason,
      verification: link ? { url: link.url, expiresAt: link.expiresAt.toISOString() } : null };
  }

  private requireProvider(): LinkedAccountsProvider {
    if (!this.provider) {
      throw new PayMongoError('PayMongo linked-account onboarding is awaiting provider verification', 503, 'LINKED_ACCOUNTS_PROVIDER_UNVERIFIED');
    }
    return this.provider;
  }

  private invalidState(): PayMongoError {
    return new PayMongoError('This action is unavailable for the current linked account state', 409, 'INVALID_LINKED_ACCOUNT_STATE');
  }
}
