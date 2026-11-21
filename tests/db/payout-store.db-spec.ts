// The Postgres payout store against a real database: concurrent runs pool a payee's earnings once, an
// unknown payout is never submitted again, and settled payouts queue exactly one outbox event.
//
//   DATABASE_URL=postgres://... npx jest --testMatch "<rootDir>/tests/db/**/*.db-spec.ts" tests/db/payout-store.db-spec.ts
import { Pool } from 'pg';
import { MockMoneyMover } from '../../apps/payments/src/features/payouts/mock-money-mover';
import type { MerchantAccount } from '../../apps/payments/src/features/payouts/merchant-accounts';
import { reconcileOpenAttempts, runPayouts, type PayoutDeps } from '../../apps/payments/src/features/payouts/payout-executor';
import { PostgresPayoutStore, type PayoutContext } from '../../apps/payments/src/features/payouts/payout-store';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Postgres payout store', () => {
  let pool: Pool;
  const projectId = `project-${Date.now()}`;
  const context: PayoutContext = { organizationId: 'org-1', projectId, consumerServiceId: 'app-1', environment: 'test' };
  const wallet: MerchantAccount = { id: 'parent', kind: 'parent', wallet: { number: '1234', name: 'ALPHAEXPLORA' }, lowFloatAlert: 0 };
  let now = new Date('2026-11-27T12:05:00Z');

  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 4 }); });
  afterAll(async () => { await pool.end(); });

  async function seed(externalRef: string) {
    const store = new PostgresPayoutStore(pool, () => now);
    const mover = new MockMoneyMover();
    const { payee } = await store.upsertPayee(context, { externalRef, legalName: 'Juan Dela Cruz' });
    await store.setPayeeDestination('test', projectId, payee.id,
      { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan Dela Cruz' }, new Date('2026-11-01T00:00:00Z'));
    await store.insertAllocations(context, [42_500, 30_000].map((amount, index) => ({
      payeeId: payee.id, merchantAccountId: 'parent', resourceType: 'intent' as const, resourceId: `pi_${externalRef}_${index}`,
      referenceId: 'order-1', template: false, paymentId: `pay_${externalRef}_${index}`, amount, grossAmount: amount,
      status: 'released' as const, createdAt: `2026-11-26T00:0${index}:00Z`,
    })));
    const deps: PayoutDeps = { store, mover, accounts: { resolve: async () => wallet, get: async () => wallet }, now: () => now };
    return { store, mover, payee, deps };
  }

  it('two concurrent runs create one payout', async () => {
    const { mover, payee, deps } = await seed(`concurrent-${Date.now()}`);
    const scope = { payeeId: payee.id, projectId };
    const reports = await Promise.all([1, 2, 3].map(() => runPayouts(deps, 'test', { kind: 'schedule' }, scope)));
    expect(reports.flatMap((report) => report.paid)).toHaveLength(1);
    expect(mover.submitted).toHaveLength(1);
    const payouts = await pool.query('SELECT gross FROM shared_payment.payouts WHERE payee_id = $1', [payee.id]);
    expect(payouts.rows.map((row) => Number(row.gross))).toEqual([72_500]);
  });

  it('never resubmits an unknown payout and settles it by lookup', async () => {
    const { mover, payee, deps } = await seed(`unknown-${Date.now()}`);
    const scope = { payeeId: payee.id, projectId };
    mover.failNext('unknown');
    const [payoutId] = (await runPayouts(deps, 'test', { kind: 'schedule' }, scope)).paid;
    const status = async () => (await pool.query('SELECT status FROM shared_payment.payouts WHERE id = $1', [payoutId])).rows[0].status;
    expect(await status()).toBe('unknown');
    expect((await runPayouts(deps, 'test', { kind: 'cash_out', cashedOutToday: 0 }, scope)).paid).toEqual([]);
    expect(mover.submitted).toHaveLength(1);

    await reconcileOpenAttempts(deps, 'test', { payoutId });
    expect(await status()).toBe('paid');
    const allocations = await pool.query('SELECT DISTINCT status FROM shared_payment.payout_allocations WHERE payee_id = $1', [payee.id]);
    expect(allocations.rows).toEqual([{ status: 'paid' }]);
    const events = await pool.query(
      `SELECT event_type, provider, owner_tribe_id, project_id, consumer_service_id, reference_id, payload
         FROM shared_payment.payment_event_outbox WHERE aggregate_id = $1`, [payoutId]);
    expect(events.rows).toEqual([expect.objectContaining({ event_type: 'payment.payout.paid', provider: 'apicenter',
      owner_tribe_id: 'org-1', project_id: projectId, consumer_service_id: 'app-1',
      payload: expect.objectContaining({ payoutId, net: 72_500, referenceId: expect.any(String) }) })]);
  });

  it('holds shares once per payment, copies link templates and claws back a refund once', async () => {
    const store = new PostgresPayoutStore(pool, () => now);
    const { payee } = await store.upsertPayee(context, { externalRef: `hold-${Date.now()}`, legalName: 'Juan Dela Cruz' });
    const linkId = `pl_${Date.now()}`;
    const intentId = `pi_hold_${Date.now()}`;
    const base = { payeeId: payee.id, merchantAccountId: 'parent', referenceId: 'ORDER-1', paymentId: null, amount: 42_500,
      grossAmount: 50_000, status: 'awaiting_payment' as const };
    await store.insertAllocations(context, [
      { ...base, resourceType: 'intent', resourceId: intentId, template: false },
      { ...base, resourceType: 'payment_link', resourceId: linkId, template: true },
    ]);

    const paymentId = `pay_hold_${Date.now()}`;
    expect(await store.holdForPayment('test', { type: 'intent', id: intentId }, paymentId)).toHaveLength(1);
    expect(await store.holdForPayment('test', { type: 'intent', id: intentId }, paymentId)).toHaveLength(0);
    expect(await store.holdForPayment('test', { type: 'payment_link', id: linkId }, `${paymentId}_a`)).toHaveLength(1);
    expect(await store.holdForPayment('test', { type: 'payment_link', id: linkId }, `${paymentId}_a`)).toHaveLength(0);
    expect(await store.holdForPayment('test', { type: 'payment_link', id: linkId }, `${paymentId}_b`)).toHaveLength(1);
    const held = await pool.query(`SELECT count(*)::int AS n FROM shared_payment.payment_event_outbox
      WHERE event_type = 'payment.allocation.held' AND project_id = $1 AND aggregate_id IN
        (SELECT id FROM shared_payment.payout_allocations WHERE payee_id = $2)`, [projectId, payee.id]);
    expect(held.rows[0].n).toBe(3);

    await pool.query(`UPDATE shared_payment.payout_allocations SET status = 'released' WHERE payment_id = $1`, [paymentId]);
    await store.applyRefund('test', { paymentId, refundId: 'ref_1', refunded: 10_000 });
    await store.applyRefund('test', { paymentId, refundId: 'ref_1', refunded: 10_000 });
    const adjustments = await pool.query(`SELECT amount FROM shared_payment.payee_adjustments WHERE payee_id = $1`, [payee.id]);
    expect(adjustments.rows.map((row) => Number(row.amount))).toEqual([-8_500]);

    await store.applyRefund('test', { paymentId: `${paymentId}_a`, refundId: 'ref_2', refunded: 50_000 });
    const cancelled = await pool.query(`SELECT status FROM shared_payment.payout_allocations WHERE payment_id = $1`, [`${paymentId}_a`]);
    expect(cancelled.rows).toEqual([{ status: 'cancelled' }]);
  });

  it('a rejected transfer frees the allocations and leaves room for a new attempt', async () => {
    const { mover, payee, deps } = await seed(`rejected-${Date.now()}`);
    const scope = { payeeId: payee.id, projectId };
    mover.failNext('rejected');
    const [failedId] = (await runPayouts(deps, 'test', { kind: 'schedule' }, scope)).paid;
    now = new Date('2026-11-27T12:20:00Z');
    const [retryId] = (await runPayouts(deps, 'test', { kind: 'cash_out', cashedOutToday: 0 }, scope)).paid;
    expect(retryId).not.toBe(failedId);
    const attempts = await pool.query(
      `SELECT a.provider_status FROM shared_payment.payout_transfer_attempts a JOIN shared_payment.payouts p ON p.id = a.payout_id
        WHERE p.payee_id = $1 ORDER BY a.submitted_at`, [payee.id]);
    expect(attempts.rows.map((row) => row.provider_status)).toEqual(['failed', 'pending']);
  });

  // Review finding: a retried create used to store every share a second time, and both were paid.
  it('stores each share once when a create is retried', async () => {
    const store = new PostgresPayoutStore(pool, () => now);
    const { payee } = await store.upsertPayee(context, { externalRef: `retry-${Date.now()}`, legalName: 'Juan Dela Cruz' });
    const share = { payeeId: payee.id, merchantAccountId: 'parent', resourceType: 'intent' as const, resourceId: `pi_retry_${Date.now()}`,
      referenceId: 'ORDER-1', template: false, paymentId: null, amount: 50_000, grossAmount: 50_000, status: 'awaiting_payment' as const };
    const first = await store.insertAllocations(context, [share]);
    const second = await store.insertAllocations(context, [share]);
    expect(second.map((allocation) => allocation.id)).toEqual(first.map((allocation) => allocation.id));
    expect(await store.holdForPayment('test', { type: 'intent', id: share.resourceId }, `pay_retry_${Date.now()}`)).toHaveLength(1);
    const stored = await pool.query('SELECT count(*)::int AS n FROM shared_payment.payout_allocations WHERE payee_id = $1', [payee.id]);
    expect(stored.rows[0].n).toBe(1);
  });

  // Review finding: two cash-outs at once both read the daily total before either was saved.
  it('keeps two concurrent cash-outs within the daily cap', async () => {
    const { mover, payee, deps } = await seed(`cap-${Date.now()}`);
    // Make the balance read slow so both runs are past isDue before either pools.
    const balance = mover.availableBalance.bind(mover);
    mover.availableBalance = async (account) => { await new Promise((resolve) => setTimeout(resolve, 200)); return balance(account); };
    await pool.query(
      `INSERT INTO shared_payment.project_payout_settings (environment, project_id, schedule_weekday, schedule_hour, immediate,
         threshold_centavos, on_demand_minimum, on_demand_daily_cap, scheduled_fee_bearer, cash_out_fee_bearer, minimum_payout,
         transfer_fee, updated_by)
       VALUES ('test', $1, 5, 20, false, NULL, 100, 50000, 'platform', 'payee', 0, 1000, 'test')
       ON CONFLICT (environment, project_id) DO UPDATE SET on_demand_daily_cap = 50000`, [projectId]);
    const scope = { payeeId: payee.id, projectId };
    try {
      await Promise.all([1, 2].map(() => runPayouts(deps, 'test', { kind: 'cash_out', cashedOutToday: 0 }, scope)));
      const total = await pool.query(`SELECT COALESCE(sum(gross), 0)::int AS total FROM shared_payment.payouts WHERE payee_id = $1`, [payee.id]);
      expect(total.rows[0].total).toBeLessThanOrEqual(50_000);
    } finally {
      await pool.query(`DELETE FROM shared_payment.project_payout_settings WHERE environment = 'test' AND project_id = $1`, [projectId]);
    }
  });

  // Review finding: the hold was only checked against the pool snapshot taken at the start of the run.
  it('does not pay a destination that changed after the run read its pools', async () => {
    const { store, mover, payee, deps } = await seed(`hold-${Date.now()}`);
    const summaries = await store.poolSummaries('test', 'parent', payee.id);
    await store.setPayeeDestination('test', projectId, payee.id,
      { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '999999999999', accountName: 'Someone Else' }, now);
    deps.store = Object.assign(Object.create(Object.getPrototypeOf(store)), store, { poolSummaries: async () => summaries });
    const report = await runPayouts(deps, 'test', { kind: 'schedule' }, { payeeId: payee.id, projectId });
    expect(report.paid).toEqual([]);
    expect(report.skipped).toEqual([{ payeeId: payee.id, reason: 'destination_hold' }]);
    expect(mover.submitted).toHaveLength(0);
  });

  it('refuses a paid share without a payout', async () => {
    const store = new PostgresPayoutStore(pool, () => now);
    const { payee } = await store.upsertPayee(context, { externalRef: `check-${Date.now()}`, legalName: 'Juan' });
    const [share] = await store.insertAllocations(context, [{ payeeId: payee.id, merchantAccountId: 'parent', resourceType: 'intent',
      resourceId: `pi_check_${Date.now()}`, referenceId: 'ORDER-1', template: false, paymentId: 'pay_x', amount: 100, grossAmount: 100,
      status: 'released' }]);
    await expect(pool.query(`UPDATE shared_payment.payout_allocations SET status = 'paid' WHERE id = $1`, [share.id]))
      .rejects.toMatchObject({ code: '23514' });
  });
});
