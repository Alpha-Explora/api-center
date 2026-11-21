// Payee shares attached to a payment when it is created. They are validated before the provider call,
// stored awaiting payment, held when the payment's webhook arrives, and cancelled or clawed back when it
// is refunded. A payment link can be paid many times, so its shares are templates copied per payment.

import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import type { VerifiedWebhook, WebhookEffects } from '../../shared/payment-owner-store';
import type { PoolClient } from 'pg';
import type { MerchantAccountResolver } from './merchant-accounts';
import type { AllocationStatus, Centavos } from './payout-ledger';
import type { AllocationRecord, PayoutContext, PayoutStore } from './payout-store';

export const allocationsInput = z.array(z.object({
  payeeId: z.string().regex(/^pye_[A-Za-z0-9]+$/),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()).min(1).max(20)
  .refine((items) => new Set(items.map((item) => item.payeeId)).size === items.length, { message: 'Each payee may appear once' });

export type AllocationInput = z.infer<typeof allocationsInput>;

export type AllocationView = { id: string; payeeId: string; amount: Centavos; status: AllocationStatus; paymentId: string | null };

export type PaidResource = { type: AllocationRecord['resourceType']; id: string; gross: Centavos; referenceId: string };

/** Parses `allocations` from a create body. Undefined when the body has none. */
export function parseAllocations(body: unknown): AllocationInput | undefined {
  const raw = (body as { allocations?: unknown } | undefined)?.allocations;
  if (raw === undefined) return undefined;
  const parsed = allocationsInput.safeParse(raw);
  if (!parsed.success) {
    throw new PayMongoError('allocations must list each payee once with a positive whole amount', 400, 'INVALID_ALLOCATIONS');
  }
  return parsed.data;
}

/** Checks payees and amounts before the payment is created, so a bad allocation never leaves a payment behind. */
export async function validateAllocations(store: PayoutStore, context: PayoutContext, items: AllocationInput, gross: Centavos): Promise<void> {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(gross) || total > gross) {
    throw new PayMongoError('Allocations add up to more than the payment amount', 400, 'ALLOCATIONS_EXCEED_AMOUNT');
  }
  const payees = await store.findPayees(context.environment, context.projectId, items.map((item) => item.payeeId));
  // Another project's payee is reported exactly like a missing one.
  if (payees.length !== items.length) throw new PayMongoError('Payee not found', 404, 'PAYEE_NOT_FOUND');
  if (payees.some((payee) => payee.status !== 'active')) throw new PayMongoError('Payee is suspended', 409, 'PAYEE_SUSPENDED');
}

export async function attachAllocations(deps: { store: PayoutStore; accounts: MerchantAccountResolver; now: () => Date },
  context: PayoutContext, resource: PaidResource, items: AllocationInput): Promise<AllocationView[]> {
  const account = await deps.accounts.resolve(context.projectId, context.environment, deps.now());
  const created = await deps.store.insertAllocations(context, items.map((item) => ({
    payeeId: item.payeeId,
    merchantAccountId: account.id,
    resourceType: resource.type,
    resourceId: resource.id,
    referenceId: resource.referenceId,
    template: resource.type === 'payment_link',
    paymentId: null,
    amount: item.amount,
    grossAmount: resource.gross,
    status: 'awaiting_payment' as const,
  })));
  return created.map(allocationView);
}

export function allocationView(allocation: AllocationRecord): AllocationView {
  return { id: allocation.id, payeeId: allocation.payeeId, amount: allocation.amount, status: allocation.status, paymentId: allocation.paymentId };
}

/** Holds shares when a payment is confirmed and settles refunds, inside the webhook's own transaction. */
export function payoutWebhookEffects(store: PayoutStore): WebhookEffects {
  return {
    async apply(webhook: VerifiedWebhook, client?: PoolClient) {
      if (webhook.paidResource) {
        await store.holdForPayment(webhook.environment,
          { type: webhook.paidResource.resourceType, id: webhook.paidResource.resourceId }, webhook.paidResource.paymentId, client);
      }
      for (const refund of webhook.refunds ?? []) await store.applyRefund(webhook.environment, refund, client);
    },
  };
}
