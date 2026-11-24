// The scheduled payout job. `schedule` runs hourly: it settles open transfers, pays every pool whose
// weekly slot has passed (isDue decides per project), then publishes the events it queued.
// `reconcile` runs every few minutes and only settles and publishes.
//
//   node dist/features/payouts/payout-runner.js schedule|reconcile

import { createPaymentEventPool, drainPaymentEventOutbox } from '../../events/paymentEventDispatcher';
import { hasPaymentEventTopic } from '../../events/pubsubPublisher';
import { PaymentOwnerStore } from '../../shared/payment-owner-store';
import { reconcileOpenAttempts, runPayouts, type RunReport } from './payout-executor';
import type { PayoutTrigger } from './payout-policy';
import { createPayoutsFeature } from './payouts-feature';

export type RunnerDeps = {
  environment: 'test' | 'live';
  reconcile: () => Promise<{ resolved: number; needsReview: number }>;
  run: (trigger: PayoutTrigger) => Promise<RunReport>;
  drain: () => Promise<void>;
  log: (line: string) => void;
};

export async function main(argv: string[], deps?: RunnerDeps): Promise<number> {
  const command = argv[0];
  if (command !== 'schedule' && command !== 'reconcile') {
    console.error('Usage: payout-runner schedule|reconcile');
    return 1;
  }
  const runner = deps ?? defaultDeps();
  try {
    const reconciled = await runner.reconcile();
    const report = command === 'schedule' ? await runner.run({ kind: 'schedule' }) : undefined;
    await runner.drain();
    runner.log(JSON.stringify({ type: 'apicenter_payout_run', command, environment: runner.environment, reconciled,
      ...(report ? { paid: report.paid.length, skipped: report.skipped.length, floatLow: report.floatLow } : {}) }));
    return 0;
  } catch (error) {
    runner.log(JSON.stringify({ type: 'apicenter_payout_run_failed', command, environment: runner.environment,
      code: (error as { code?: string }).code, message: (error as Error).message }));
    return 1;
  }
}

function defaultDeps(): RunnerDeps {
  const environment = process.env.PAYMENT_PROVIDER_MODE === 'live' ? 'live' : 'test';
  const feature = createPayoutsFeature(PaymentOwnerStore.getInstance());
  return {
    environment,
    reconcile: () => reconcileOpenAttempts(feature, environment),
    run: (trigger) => runPayouts(feature, environment, trigger),
    drain: async () => {
      if (!hasPaymentEventTopic(environment)) return;
      const pool = createPaymentEventPool();
      try {
        await drainPaymentEventOutbox({ pool, limit: 100, environment });
      } finally {
        await pool.end();
      }
    },
    log: (line) => console.log(line),
  };
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
