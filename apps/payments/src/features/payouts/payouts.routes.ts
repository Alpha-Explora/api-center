// The payments runtime's payout routes. Every route is scoped to the caller's signed project; another
// project's payee, allocation or payout answers 404. The gateway exposes these under /api/v1/payments.

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import type { PaymentContext } from '../../shared/payment-owner-store';
import { allocationView } from './allocations';
import { reconcileOpenAttempts, runPayouts, type PayoutDeps } from './payout-executor';
import { PayoutStateError } from './payout-ledger';
import { nextScheduledSlot, payoutPolicySchema } from './payout-policy';
import { payoutContext, type Environment, type Payee } from './payout-store';

export type RouteHelpers = {
  ok: (res: Response, data: unknown, status?: number) => unknown;
  context: (req: Request) => PaymentContext;
  handleError: (res: Response, error: unknown) => unknown;
};

const payeeInput = z.object({
  externalRef: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(1).max(200),
}).strict();

export const destinationInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('instapay'),
    bic: z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/),
    accountNumber: z.string().regex(/^[0-9]{6,20}$/),
    accountName: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal('provider_wallet'),
    accountNumber: z.string().regex(/^[0-9]{6,20}$/),
    accountName: z.string().trim().min(1).max(200),
  }).strict(),
]);

const pageInput = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const payoutListInput = pageInput.extend({
  payeeId: z.string().regex(/^pye_[A-Za-z0-9]+$/).optional(),
  status: z.enum(['draft', 'submitting', 'pending', 'unknown', 'paid', 'failed', 'needs_review']).optional(),
});

const resolutionInput = z.object({
  outcome: z.enum(['paid', 'failed']),
  note: z.string().trim().min(1).max(500),
  actor: z.string().trim().min(1).max(200),
}).strict();

const ids = {
  payee: z.string().regex(/^pye_[A-Za-z0-9]+$/),
  allocation: z.string().regex(/^pal_[A-Za-z0-9]+$/),
  payout: z.string().regex(/^po_[A-Za-z0-9]+$/),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
};

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PayMongoError(message, 400, code);
  return parsed.data;
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : String(value ?? '');
}

function notFound(kind: 'Payee' | 'Allocation' | 'Payout'): PayMongoError {
  return new PayMongoError(`${kind} not found`, 404, `${kind.toUpperCase()}_NOT_FOUND`);
}

export function registerPayoutRoutes(app: Express, deps: PayoutDeps, helpers: RouteHelpers): void {
  const route = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      helpers.handleError(res, error);
    }
  };

  const ownedPayee = async (req: Request): Promise<{ payee: Payee; environment: Environment; projectId: string }> => {
    const context = payoutContext(helpers.context(req));
    const id = ids.payee.safeParse(param(req, 'payeeId'));
    const payee = id.success ? await deps.store.getPayee(context.environment, context.projectId, id.data) : null;
    if (!payee) throw notFound('Payee');
    return { payee, environment: context.environment, projectId: context.projectId };
  };

  app.post('/payouts/payees', route(async (req, res) => {
    const input = parse(payeeInput, req.body, 'INVALID_PAYEE', 'externalRef and legalName are required');
    const { payee, created } = await deps.store.upsertPayee(payoutContext(helpers.context(req)), input);
    helpers.ok(res, payee, created ? 201 : 200);
  }));

  app.get('/payouts/payees', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    const query = parse(pageInput, req.query, 'INVALID_QUERY', 'cursor or limit is invalid');
    helpers.ok(res, await deps.store.listPayees(context.environment, context.projectId, query));
  }));

  app.get('/payouts/payees/:payeeId', route(async (req, res) => {
    const { payee, environment } = await ownedPayee(req);
    helpers.ok(res, { ...payee, earnings: await deps.store.earnings(environment, payee.id, deps.now()) });
  }));

  app.put('/payouts/payees/:payeeId/destination', route(async (req, res) => {
    const { payee, environment, projectId } = await ownedPayee(req);
    const destination = parse(destinationInput, req.body, 'INVALID_DESTINATION',
      'destination needs a type, a valid bic for instapay, a 6–20 digit account number and an account name');
    helpers.ok(res, await deps.store.setPayeeDestination(environment, projectId, payee.id, destination, deps.now()));
  }));

  app.post('/payouts/payees/:payeeId/cash-out', route(async (req, res) => {
    const { payee, environment, projectId } = await ownedPayee(req);
    const report = await runPayouts(deps, environment, { kind: 'cash_out', cashedOutToday: 0 }, { payeeId: payee.id, projectId });
    const [payoutId] = report.paid;
    if (!payoutId) {
      const reason = report.skipped[0]?.reason ?? 'nothing_released';
      throw new PayMongoError(`Cash-out is not possible: ${reason.replace(/_/g, ' ')}`, 409, reason.toUpperCase());
    }
    helpers.ok(res, await deps.store.getPayout(environment, projectId, payoutId), 202);
  }));

  for (const event of ['release', 'cancel'] as const) {
    app.post(`/payouts/allocations/:allocationId/${event}`, route(async (req, res) => {
      const context = payoutContext(helpers.context(req));
      const id = ids.allocation.safeParse(param(req, 'allocationId'));
      if (!id.success) throw notFound('Allocation');
      const allocation = await deps.store.changeAllocation(context.environment, context.projectId, id.data, event);
      helpers.ok(res, allocationView(allocation));
      if (event === 'release') payOnRelease(deps, context.environment, context.projectId, allocation.payeeId);
    }));
  }

  app.get('/admin/payouts/overview', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    const now = deps.now();
    const account = await deps.accounts.resolve(context.projectId, context.environment, now);
    let available: number | null = null;
    if (account.wallet) {
      try {
        available = await deps.mover.availableBalance(account);
      } catch (error) {
        console.warn(JSON.stringify({ type: 'apicenter_payout_balance_unavailable', environment: context.environment,
          message: (error as Error).message }));
      }
    }
    const policy = await deps.store.getSettings(context.environment, context.projectId);
    helpers.ok(res, {
      wallet: { configured: account.wallet !== null, available, lowFloatAlert: account.lowFloatAlert },
      counts: await deps.store.payoutCounts(context.environment, context.projectId),
      needsReview: (await deps.store.listPayouts(context.environment, context.projectId, { status: 'needs_review', limit: 100 })).records,
      nextScheduledAt: policy.schedule ? nextScheduledSlot(policy.schedule, now).toISOString() : null,
    });
  }));

  app.get('/admin/payouts/settings', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    helpers.ok(res, await deps.store.getSettings(context.environment, context.projectId));
  }));

  app.post('/admin/payouts/settings', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    const { actor, ...policyInput } = (req.body ?? {}) as Record<string, unknown>;
    const policy = parse(payoutPolicySchema, policyInput, 'INVALID_PAYOUT_SETTINGS', 'The payout settings are invalid');
    const updatedBy = parse(resolutionInput.shape.actor, actor, 'INVALID_PAYOUT_SETTINGS', 'actor is required');
    helpers.ok(res, await deps.store.saveSettings(context.environment, context.projectId, policy, updatedBy));
  }));

  app.post('/admin/payouts/:payoutId/resolve', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    const id = ids.payout.safeParse(param(req, 'payoutId'));
    const payout = id.success ? await deps.store.getPayout(context.environment, context.projectId, id.data) : null;
    if (!payout) throw notFound('Payout');
    const input = parse(resolutionInput, req.body, 'INVALID_RESOLUTION', 'outcome, a note of up to 500 characters and actor are required');
    try {
      helpers.ok(res, await deps.store.recordOutcome(context.environment, payout.id,
        input.outcome === 'paid' ? 'operator_paid' : 'operator_failed', { note: input.note, actor: input.actor }));
    } catch (error) {
      if (error instanceof PayoutStateError) {
        throw new PayMongoError(`A payout that is ${error.from} cannot be resolved by an operator`, 409, 'INVALID_PAYOUT_STATE');
      }
      throw error;
    }
  }));

  app.get('/payouts', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    const query = parse(payoutListInput, req.query, 'INVALID_QUERY', 'payeeId, status, cursor or limit is invalid');
    helpers.ok(res, await deps.store.listPayouts(context.environment, context.projectId, query));
  }));

  app.get('/payouts/:payoutId', route(async (req, res) => {
    const context = payoutContext(helpers.context(req));
    const id = ids.payout.safeParse(param(req, 'payoutId'));
    const payout = id.success ? await deps.store.getPayout(context.environment, context.projectId, id.data) : null;
    if (!payout) throw notFound('Payout');
    helpers.ok(res, payout);
  }));
}

/**
 * PayMongo's transfer callback, forwarded by the gateway. Its body is never trusted: the token only
 * names the payout to look up at PayMongo. Unknown tokens are acknowledged so PayMongo stops retrying.
 */
export function registerPayoutCallbackRoute(app: Express, deps: PayoutDeps, helpers: Pick<RouteHelpers, 'handleError'>): void {
  app.post('/payouts/callbacks/:token', async (req: Request, res: Response) => {
    try {
      const token = ids.token.safeParse(param(req, 'token'));
      const attempt = token.success ? await deps.store.attemptByCallbackToken(token.data) : null;
      if (attempt && attempt.environment === req.get('X-APICenter-Environment')) {
        await reconcileOpenAttempts(deps, attempt.environment, { payoutId: attempt.payoutId });
      }
      res.status(204).end();
    } catch (error) {
      helpers.handleError(res, error);
    }
  });
}

/** A release can make a pool due under an immediate or threshold policy; pay it after answering. */
function payOnRelease(deps: PayoutDeps, environment: Environment, projectId: string, payeeId: string): void {
  setImmediate(() => {
    void (async () => {
      const policy = await deps.store.getSettings(environment, projectId);
      if (!policy.immediate && policy.thresholdCentavos === null) return;
      await runPayouts(deps, environment, { kind: 'release' }, { payeeId, projectId });
    })().catch((error: Error) => {
      console.error(JSON.stringify({ type: 'apicenter_payout_release_run_failed', environment, payeeId, code: (error as PayMongoError).code,
        message: error.message }));
    });
  });
}
