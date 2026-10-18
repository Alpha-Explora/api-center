import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';

describe('payment link archive reconciliation', () => {
  const owner = { tribeId: 'tribe-a', projectId: 'project-a', consumerServiceId: 'service-a', environment: 'test' as const };

  it.each([true, false])('preserves archive and paid facts when the webhook arrives first: %s', async (webhookFirst) => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: 'payment_link', resourceId: 'pl_123',
      snapshot: { status: 'active', archived: false } });
    const paid = () => store.applyVerifiedWebhook({ providerEventId: 'evt_link', environment: 'test',
      eventType: 'payment.paid', payloadHash: 'test-hash', receiptStatus: 'processed',
      updates: [{ ...owner, resourceType: 'payment_link', resourceId: 'pl_123', status: 'paid',
        snapshot: { status: 'paid', paymentId: 'pay_123' } }] });
    if (webhookFirst) await paid();
    await store.reconcilePaymentLink('pl_123', owner, { status: 'active', archived: true });
    if (!webhookFirst) await paid();
    const current = await store.assertOwned('payment_link', 'pl_123', owner);
    expect(current.snapshot).toMatchObject({ status: 'paid', archived: true, paymentId: 'pay_123' });
    expect(current.status).toBe('paid');
  });
});
