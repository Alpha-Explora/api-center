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
});
