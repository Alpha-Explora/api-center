import { createHmac } from 'node:crypto';
import { WebhooksService } from '../../../../../apps/payments/src/features/webhooks/webhooks.service';
import { PaymentOwnerStore } from '../../../../../apps/payments/src/shared/payment-owner-store';
import {
  attachAllocations,
  parseAllocations,
  payoutWebhookEffects,
  validateAllocations,
} from '../../../../../apps/payments/src/features/payouts/allocations';
import { MockMoneyMover } from '../../../../../apps/payments/src/features/payouts/mock-money-mover';
import type { MerchantAccount } from '../../../../../apps/payments/src/features/payouts/merchant-accounts';
import { runPayouts } from '../../../../../apps/payments/src/features/payouts/payout-executor';
import { MemoryPayoutStore, type PayoutContext } from '../../../../../apps/payments/src/features/payouts/payout-store';

const owner = { tribeId: 'org-1', projectId: 'project-1', consumerServiceId: 'app-1', environment: 'test' as const };
const context: PayoutContext = { organizationId: 'org-1', projectId: 'project-1', consumerServiceId: 'app-1', environment: 'test' };
const wallet: MerchantAccount = { id: 'parent', kind: 'parent', wallet: { number: '1234', name: 'ALPHAEXPLORA' }, lowFloatAlert: 0 };
const accounts = { resolve: async () => wallet, get: async () => wallet };

function signed(payload: unknown) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = '1760000000';
  const signature = createHmac('sha256', 'test-webhook-secret').update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  return { rawBody, signatureHeader: `t=${timestamp},te=${signature}`, environment: 'test' };
}

const intentPaid = (eventId: string, paymentId = 'pay_1') => ({ data: { id: eventId, attributes: { type: 'payment.paid', livemode: false,
  created_at: 1760000000, data: { id: paymentId, type: 'payment',
    attributes: { payment_intent_id: 'pi_1', status: 'paid', amount: 50_000, currency: 'PHP' } } } } });

const linkPaid = (eventId: string, paymentId: string) => ({ data: { id: eventId, attributes: { type: 'link.payment.paid', livemode: false,
  data: { id: paymentId, type: 'payment', attributes: { status: 'paid', amount: 50_000, external_reference_number: 'LINKREF1' } } } } });

const refunded = (eventId: string, refundId: string, amount: number) => ({ data: { id: eventId, attributes: { type: 'payment.refund.updated',
  livemode: false, data: { id: refundId, type: 'refund', attributes: { status: 'succeeded', payment_id: 'pay_1', amount, currency: 'PHP' } } } } });

describe('allocations', () => {
  const previousSecret = process.env.PAYMONGO_TEST_WEBHOOK_SECRET;
  let now = new Date('2026-11-24T00:00:00Z');
  let store: MemoryPayoutStore;
  let owners: PaymentOwnerStore;
  let payeeId: string;
  const deps = () => ({ store, accounts, mover: new MockMoneyMover(), now: () => now });

  beforeEach(async () => {
    process.env.PAYMONGO_TEST_WEBHOOK_SECRET = 'test-webhook-secret';
    now = new Date('2026-11-24T00:00:00Z');
    store = new MemoryPayoutStore(() => now);
    owners = new PaymentOwnerStore('');
    owners.useWebhookEffects(payoutWebhookEffects(store));
    payeeId = (await store.upsertPayee(context, { externalRef: 'ext-1', legalName: 'Juan Dela Cruz' })).payee.id;
    await store.setPayeeDestination('test', 'project-1', payeeId,
      { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan Dela Cruz' }, new Date('2026-11-01T00:00:00Z'));
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.PAYMONGO_TEST_WEBHOOK_SECRET;
    else process.env.PAYMONGO_TEST_WEBHOOK_SECRET = previousSecret;
  });

  async function intentWithShare(amount = 42_500) {
    await owners.save({ ...owner, resourceType: 'intent', resourceId: 'pi_1', referenceId: 'ORDER-1', snapshot: { paymentIntentId: 'pi_1' } });
    const [allocation] = await attachAllocations(deps(), context, { type: 'intent', id: 'pi_1', gross: 50_000, referenceId: 'ORDER-1' },
      [{ payeeId, amount }]);
    return allocation;
  }

  it('parses allocations and rejects malformed ones', () => {
    expect(parseAllocations({})).toBeUndefined();
    expect(parseAllocations({ allocations: [{ payeeId: 'pye_1', amount: 100 }] })).toEqual([{ payeeId: 'pye_1', amount: 100 }]);
    for (const allocations of [[], [{ payeeId: 'pye_1', amount: 0 }], [{ payeeId: 'x', amount: 1 }],
      [{ payeeId: 'pye_1', amount: 1 }, { payeeId: 'pye_1', amount: 2 }]]) {
      expect(() => parseAllocations({ allocations })).toThrow(expect.objectContaining({ code: 'INVALID_ALLOCATIONS' }));
    }
  });

  it('rejects allocations for another project\'s payee', async () => {
    const other = (await store.upsertPayee({ ...context, projectId: 'project-2' }, { externalRef: 'ext-9', legalName: 'Other' })).payee.id;
    await expect(validateAllocations(store, context, [{ payeeId: other, amount: 100 }], 50_000))
      .rejects.toMatchObject({ statusCode: 404, code: 'PAYEE_NOT_FOUND' });
  });

  it('rejects allocations above the gross amount', async () => {
    const second = (await store.upsertPayee(context, { externalRef: 'ext-2', legalName: 'Maria' })).payee.id;
    await expect(validateAllocations(store, context, [{ payeeId, amount: 30_000 }, { payeeId: second, amount: 30_000 }], 50_000))
      .rejects.toMatchObject({ statusCode: 400, code: 'ALLOCATIONS_EXCEED_AMOUNT' });
  });

  it('rejects a suspended payee', async () => {
    store.payees.get(payeeId)!.status = 'suspended';
    await expect(validateAllocations(store, context, [{ payeeId, amount: 100 }], 50_000)).rejects.toMatchObject({ code: 'PAYEE_SUSPENDED' });
  });

  it('attaches allocations and holds them when the payment is paid', async () => {
    const allocation = await intentWithShare();
    expect(allocation).toMatchObject({ payeeId, amount: 42_500, status: 'awaiting_payment', paymentId: null });

    await new WebhooksService(owners).processWebhook(intentPaid('evt_1'), signed(intentPaid('evt_1')));
    expect(store.allocations.get(allocation.id)).toMatchObject({ status: 'held', paymentId: 'pay_1' });
    expect(store.events).toEqual([expect.objectContaining({ eventType: 'payment.allocation.held', aggregateId: allocation.id,
      referenceId: 'ORDER-1', payload: expect.objectContaining({ payeeId, paymentId: 'pay_1', amount: 42_500, currency: 'PHP' }) })]);
  });

  it('a duplicate paid webhook holds once', async () => {
    await intentWithShare();
    const service = new WebhooksService(owners);
    await service.processWebhook(intentPaid('evt_1'), signed(intentPaid('evt_1')));
    await service.processWebhook(intentPaid('evt_1'), signed(intentPaid('evt_1')));
    await service.processWebhook(intentPaid('evt_2', 'pay_2'), signed(intentPaid('evt_2', 'pay_2')));
    expect([...store.allocations.values()].map((entry) => [entry.status, entry.paymentId])).toEqual([['held', 'pay_1']]);
    expect(store.events).toHaveLength(1);
  });

  it('payment link allocations copy per paid payment', async () => {
    await owners.save({ ...owner, resourceType: 'payment_link', resourceId: 'pl_1', referenceId: 'LINK-1', providerReference: 'LINKREF1',
      snapshot: { paymentLinkId: 'pl_1' } });
    await attachAllocations(deps(), context, { type: 'payment_link', id: 'pl_1', gross: 50_000, referenceId: 'LINK-1' }, [{ payeeId, amount: 42_500 }]);
    const service = new WebhooksService(owners);
    await service.processWebhook(linkPaid('evt_l1', 'pay_a'), signed(linkPaid('evt_l1', 'pay_a')));
    await service.processWebhook(linkPaid('evt_l2', 'pay_b'), signed(linkPaid('evt_l2', 'pay_b')));
    const rows = [...store.allocations.values()];
    expect(rows.filter((entry) => entry.template)).toHaveLength(1);
    expect(rows.filter((entry) => !entry.template).map((entry) => [entry.status, entry.paymentId]))
      .toEqual([['held', 'pay_a'], ['held', 'pay_b']]);
  });

  it('refund before release cancels; refund after payout claws back on next payout', async () => {
    const allocation = await intentWithShare();
    const service = new WebhooksService(owners);
    await service.processWebhook(intentPaid('evt_1'), signed(intentPaid('evt_1')));
    await owners.save({ ...owner, resourceType: 'refund', resourceId: 'ref_full', snapshot: { refundId: 'ref_full', paymentId: 'pay_1' } });
    await service.processWebhook(refunded('evt_r1', 'ref_full', 50_000), signed(refunded('evt_r1', 'ref_full', 50_000)));
    expect(store.allocations.get(allocation.id)!.status).toBe('cancelled');
  });

  it('claws back a refund of a share that was already paid out', async () => {
    const allocation = await intentWithShare();
    const service = new WebhooksService(owners);
    await service.processWebhook(intentPaid('evt_1'), signed(intentPaid('evt_1')));
    store.moveAllocation(allocation.id, 'release');
    now = new Date('2026-11-27T12:05:00Z');
    await runPayouts(deps(), 'test', { kind: 'schedule' });
    const [first] = [...store.payouts.values()];
    // Settle the first payout as paid, as the reconciler would once PayMongo confirms it.
    await store.recordOutcome('test', first.id, 'provider_succeeded');
    expect(store.allocations.get(allocation.id)!.status).toBe('paid');

    await owners.save({ ...owner, resourceType: 'refund', resourceId: 'ref_part', snapshot: { refundId: 'ref_part', paymentId: 'pay_1' } });
    const partial = refunded('evt_r2', 'ref_part', 10_000);
    await service.processWebhook(partial, signed(partial));
    await service.processWebhook(partial, signed(partial));
    expect([...store.adjustments.values()].map((entry) => entry.amount)).toEqual([-8_500]);

    await store.insertAllocations(context, [{ payeeId, merchantAccountId: 'parent', resourceType: 'intent', resourceId: 'pi_2',
      referenceId: 'ORDER-2', template: false, paymentId: 'pay_2', amount: 20_000, grossAmount: 20_000, status: 'released' }]);
    now = new Date('2026-12-04T12:05:00Z');
    const [secondId] = (await runPayouts(deps(), 'test', { kind: 'schedule' })).paid;
    expect(store.payouts.get(secondId)).toMatchObject({ gross: 20_000, net: 11_500 });
  });
});
