import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import type { RouteHelpers } from '../payouts/payouts.routes';
import type { LinkedAccountOnboarding } from './linked-account-onboarding';
import { merchantDetailsInput } from './linked-accounts-provider';
import { FeaturePausedError } from '../payouts/feature-pauses';

const base = '/admin/payouts/linked-account';
const id = z.string().regex(/^lac_[A-Za-z0-9]+$/);
const accountInput = z.object({ id }).strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PayMongoError('Invalid linked account request', 400, 'INVALID_LINKED_ACCOUNT_REQUEST');
  return parsed.data;
}

export function registerLinkedAccountRoutes(app: Express, onboarding: LinkedAccountOnboarding, helpers: RouteHelpers): void {
  const route = (handler: (req: Request, context: ReturnType<RouteHelpers['context']>) => Promise<unknown>, checkPause = false) =>
    async (req: Request, res: Response) => {
      try {
        const context = helpers.context(req);
        if (context.consumerServiceId !== 'console') throw new PayMongoError('Console access is required', 403, 'FORBIDDEN');
        if (checkPause && await helpers.pauses?.isPaused(context.environment, 'merchant_account')) {
          throw new FeaturePausedError('merchant_account');
        }
        const result = await handler(req, context);
        res.set('Cache-Control', 'no-store');
        helpers.ok(res, result);
      } catch (error) {
        if (error instanceof PayMongoError && error.code === 'PROVIDER_RATE_LIMITED') {
          res.set('Retry-After', String(error.details?.retryAfter ?? 30));
        }
        helpers.handleError(res, error);
      }
    };

  app.get(base, route(async (_req, context) => onboarding.status(context)));
  app.put(`${base}/enabled`, route(async (req, context) => {
    const { enabled, actor } = parse(z.object({ enabled: z.boolean(), actor: z.string().min(1).max(200) }).strict(), req.body);
    await onboarding.switches.setProject(context.environment, context.projectId, enabled, actor);
    return { enabled };
  }));
  app.post(base, route(async (req, context) => onboarding.start(context, parse(merchantDetailsInput, req.body)), true));
  app.post(`${base}/verification-link`, route(async (req, context) => {
    const input = parse(accountInput.extend({ requestKey: z.uuid() }), req.body);
    return onboarding.reissueVerificationLink(context, input.id, input.requestKey);
  }, true));
  app.post(`${base}/advance`, route(async (req, context) => onboarding.advance(context, parse(accountInput, req.body).id), true));
  app.post(`${base}/move`, route(async (req, context) => {
    const input = parse(accountInput.extend({ target: z.enum(['child', 'parent']) }), req.body);
    await onboarding.moveProject(context, input.id, input.target);
    return { id: input.id };
  }, true));
  app.post(`${base}/close`, route(async (req, context) => {
    const input = parse(accountInput, req.body);
    await onboarding.close(context, input.id);
    return { id: input.id };
  }));
}
