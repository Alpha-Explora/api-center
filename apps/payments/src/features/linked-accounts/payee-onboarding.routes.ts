import type { Express, Request, Response } from 'express';
import type { AccountEvent } from './account-events';
import { PayMongoError } from '../../shared/payment-errors';
import type { PayoutDeps } from '../payouts/payout-executor';
import type { RouteHelpers } from '../payouts/payouts.routes';
import type { LinkedAccountOnboarding } from './linked-account-onboarding';
import { consumerDetailsInput, type ConsumerDetails } from './linked-accounts-provider';
import { FeaturePausedError } from '../payouts/feature-pauses';

export function registerPayeeOnboardingRoutes(app: Express, options: {
  onboarding: LinkedAccountOnboarding<ConsumerDetails>;
  payees: Pick<PayoutDeps['store'], 'getPayee'>;
  helpers: RouteHelpers;
  persistent: boolean;
  publish: () => Promise<void>;
  /** In the deployed test environment: provider events the simulated identity check queued, applied after each step. */
  simulatedEvents?: { takeEvents(): AccountEvent[] };
}): void {
  const { onboarding, payees, helpers, persistent, publish, simulatedEvents } = options;
  const settle = async <T extends { verification?: unknown }>(environment: 'test' | 'live', scope: Parameters<typeof onboarding.current>[0], view: T) => {
    const events = simulatedEvents?.takeEvents() ?? [];
    if (!events.length) return view;
    for (const event of events) await onboarding.applyProviderEvent(environment, event);
    const current = await onboarding.current(scope);
    return current ? { ...current, verification: view.verification ?? null } : view;
  };
  const path = '/payouts/payees/:payeeId/onboarding';
  const route = (action: 'get' | 'start' | 'verification-link' | 'activate') => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const context = helpers.context(req);
      if (context.environment !== 'test' || !persistent) {
        throw new PayMongoError('Payee wallet onboarding is unavailable in this environment', 503, 'PAYEE_ONBOARDING_DISABLED');
      }
      if (action !== 'get' && await helpers.pauses?.isPaused(context.environment, 'payee_wallets')) {
        throw new FeaturePausedError('payee_wallets');
      }
      const payeeId = req.params.payeeId;
      const payee = typeof payeeId === 'string' && /^pye_[A-Za-z0-9]+$/.test(payeeId)
        ? await payees.getPayee(context.environment, context.projectId, payeeId, context.tribeId) : null;
      if (!payee) {
        throw new PayMongoError('Payee not found', 404, 'PAYEE_NOT_FOUND');
      }
      if (action !== 'get') await onboarding.switches.assertEnabledFor(context.environment, context.projectId);
      const scope = { ...context, payeeId: payee.id };
      if (action !== 'get' && payee.status !== 'active') {
        throw new PayMongoError('Payee must be active to change onboarding', 409, 'PAYEE_INACTIVE');
      }
      const key = req.get('Idempotency-Key')?.trim() ?? '';
      if (action !== 'get' && !key) {
        throw new PayMongoError('Idempotency-Key is required', 400, 'IDEMPOTENCY_KEY_REQUIRED');
      }
      if (action === 'start') {
        const details = consumerDetailsInput.safeParse(req.body);
        if (!details.success) throw new PayMongoError('First name, last name and email are required', 400, 'INVALID_PAYEE_ONBOARDING');
        const view = await settle(context.environment, scope, await onboarding.start(scope, details.data));
        await publish();
        return helpers.ok(res, view);
      }
      const current = await onboarding.current(scope);
      if (!current) throw new PayMongoError('Payee onboarding not found', 404, 'PAYEE_ONBOARDING_NOT_FOUND');
      if (action === 'get') return helpers.ok(res, current);
      const view = await settle(context.environment, scope, action === 'activate' ? await onboarding.advance(scope, current.id)
        : await onboarding.reissueVerificationLink(scope, current.id, key));
      await publish();
      return helpers.ok(res, view);
    } catch (error) {
      if (error instanceof PayMongoError && error.code === 'PROVIDER_RATE_LIMITED') {
        res.setHeader('Retry-After', String(error.details?.retryAfter ?? 30));
      }
      return helpers.handleError(res, error);
    }
  };
  app.get(path, route('get'));
  app.post(path, route('start'));
  app.post(`${path}/verification-link`, route('verification-link'));
  app.post(`${path}/activate`, route('activate'));
}
