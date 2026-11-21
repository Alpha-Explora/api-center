import { main, type RunnerDeps } from '../../../../../apps/payments/src/features/payouts/payout-runner';

describe('payout runner', () => {
  function deps() {
    const calls: string[] = [];
    const runnerDeps: RunnerDeps = {
      environment: 'test',
      reconcile: jest.fn(async () => { calls.push('reconcile'); return { resolved: 0, needsReview: 0 }; }),
      run: jest.fn(async (trigger) => { calls.push(`run:${trigger.kind}`); return { paid: [], skipped: [], floatLow: false }; }),
      drain: jest.fn(async () => { calls.push('drain'); }),
      log: jest.fn(),
    };
    return { calls, runnerDeps };
  }

  it('reconciles, pays scheduled pools, then publishes events', async () => {
    const { calls, runnerDeps } = deps();
    await expect(main(['schedule'], runnerDeps)).resolves.toBe(0);
    expect(calls).toEqual(['reconcile', 'run:schedule', 'drain']);
    expect(runnerDeps.log).toHaveBeenCalledWith(expect.stringContaining('"type":"apicenter_payout_run"'));
  });

  it('only reconciles and publishes on a reconcile run', async () => {
    const { calls, runnerDeps } = deps();
    await expect(main(['reconcile'], runnerDeps)).resolves.toBe(0);
    expect(calls).toEqual(['reconcile', 'drain']);
  });

  it('rejects an unknown command without doing anything', async () => {
    const { calls, runnerDeps } = deps();
    await expect(main(['bogus'], runnerDeps)).resolves.toBe(1);
    expect(calls).toEqual([]);
  });

  it('fails the run when payouts fail', async () => {
    const { runnerDeps } = deps();
    runnerDeps.run = jest.fn(async () => { throw Object.assign(new Error('Live payouts are disabled'), { code: 'PAYOUTS_LIVE_DISABLED' }); });
    await expect(main(['schedule'], runnerDeps)).resolves.toBe(1);
    expect(runnerDeps.log).toHaveBeenCalledWith(expect.stringContaining('PAYOUTS_LIVE_DISABLED'));
  });
});
