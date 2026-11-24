import { createHmac, randomUUID } from 'node:crypto';
import { parseAccountEvent } from '../../../../../apps/payments/src/features/linked-accounts/account-events';
import { LinkedAccountOnboarding } from '../../../../../apps/payments/src/features/linked-accounts/linked-account-onboarding';
import { LinkedAccountStore } from '../../../../../apps/payments/src/features/linked-accounts/linked-account-store';
import { FakeLinkedAccountsProvider, type LinkedAccountsProvider } from '../../../../../apps/payments/src/features/linked-accounts/linked-accounts-provider';
import { createLinkedAccountsSwitch } from '../../../../../apps/payments/src/features/linked-accounts/linked-accounts-switch';
import { WebhooksService } from '../../../../../apps/payments/src/features/webhooks/webhooks.service';
import { PaymentOwnerStore } from '../../../../../apps/payments/src/shared/payment-owner-store';

const context = { environment: 'test' as const, tribeId: 'org_example', projectId: 'prj_example', consumerServiceId: 'console' };
const details = { businessName: 'Test shop', tin: '111-111-111', expectedMonthlyVolume: 5_000_000,
  representative: { firstName: 'Test', lastName: 'Operator', email: 'operator@example.test' } };

function setup() {
  const store = new LinkedAccountStore();
  const switches = createLinkedAccountsSwitch();
  const provider = new FakeLinkedAccountsProvider();
  const onboarding = new LinkedAccountOnboarding(store, switches, provider);
  return { store, switches, provider, onboarding };
}

describe('linked account onboarding', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env.LINKED_ACCOUNTS_ENABLED = 'true'; });
  afterEach(() => {
    for (const key of ['LINKED_ACCOUNTS_ENABLED', 'PAYMONGO_TEST_WEBHOOK_SECRET']) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('requires both switches and returns the hosted URL only when issued', async () => {
    const { switches, provider, onboarding } = setup();
    const create = jest.spyOn(provider, 'create');
    await expect(onboarding.start(context, details)).rejects.toMatchObject({ statusCode: 503, code: 'LINKED_ACCOUNTS_DISABLED' });
    expect(create).not.toHaveBeenCalled();
    await switches.setProject('test', context.projectId, true, 'operator');

    const started = await onboarding.start(context, details);
    expect(started).toMatchObject({ status: 'verification_pending', nextAction: 'await_verification',
      verification: { url: expect.stringMatching(/^https:\/\//), expiresAt: expect.any(String) } });
    const retried = await onboarding.start(context, details);
    expect(retried).toMatchObject({ id: started.id, verification: null });
    expect(await onboarding.current(context)).toEqual(retried);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(onboarding.moveProject({ ...context, projectId: 'unrelated' }, started.id, 'parent'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('retains an unknown create and reconciles it without a second provider create', async () => {
    const { switches, provider, onboarding } = setup();
    await switches.setProject('test', context.projectId, true, 'operator');
    const create = provider.create.bind(provider);
    const call = jest.spyOn<LinkedAccountsProvider, 'create'>(provider, 'create')
      .mockImplementationOnce(async (reference) => { await create(reference); return { kind: 'unknown' }; });

    await expect(onboarding.start(context, details)).rejects.toMatchObject({ code: 'LINKED_ACCOUNT_OUTCOME_UNKNOWN' });
    await expect(onboarding.start(context, details)).resolves.toMatchObject({ status: 'verification_pending' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('deduplicates signed failure events and stops issuing links after three sessions fail', async () => {
    const { store, switches, onboarding } = setup();
    await switches.setProject('test', context.projectId, true, 'operator');
    const started = await onboarding.start(context, details);
    process.env.PAYMONGO_TEST_WEBHOOK_SECRET = 'local-signature-secret';
    const webhooks = new WebhooksService(new PaymentOwnerStore(''), undefined, undefined, onboarding);
    for (let index = 0; index < 3; index += 1) {
      const record = (await store.current(context))!;
      const payload = { data: { id: `evt_${index}`, attributes: { type: 'account.identity_verification.failed', livemode: true,
        data: { id: record.verificationSessionId, account_id: record.providerAccountId } } } };
      expect(parseAccountEvent(payload)).toMatchObject({ event: { type: 'verification_failed' } });
      const rawBody = Buffer.from(JSON.stringify(payload));
      const te = createHmac('sha256', process.env.PAYMONGO_TEST_WEBHOOK_SECRET).update(`1.${rawBody}`).digest('hex');
      const options = { rawBody, signatureHeader: `t=1,te=${te}`, environment: 'test' };
      await expect(webhooks.processWebhook(payload, { ...options, signatureHeader: 'wrong' })).rejects.toMatchObject({ statusCode: 401 });
      await expect(webhooks.processWebhook(payload, options)).resolves.toMatchObject({ event: 'applied' });
      await expect(webhooks.processWebhook(payload, options)).resolves.toMatchObject({ event: 'duplicate' });
      if (index < 2) await onboarding.reissueVerificationLink(context, started.id, randomUUID());
    }
    await expect(onboarding.current(context)).resolves.toMatchObject({ status: 'manual_review', attempts: 3, walletOnly: true });
    await expect(onboarding.reissueVerificationLink(context, started.id, randomUUID())).rejects
      .toMatchObject({ code: 'VERIFICATION_ATTEMPTS_EXHAUSTED' });
  });
});
