export {};
const { createMemoryPaymentStore } = require('../../../../apps/payments/src/services/paymongo/paymentStore.memory');

describe('payment state and outbox', () => {
  it('increments aggregate versions and inserts one outbox record per provider event', async () => {
    const store = createMemoryPaymentStore();
    await store.createCheckoutSessionRecord({
      tribeId: 'tribe-alpha',
      environment: 'test',
      provider: 'paymongo',
      providerMode: 'test',
      checkoutId: 'chk_123',
      referenceId: 'order-123',
      status: 'pending',
      amount: { value: 39900, currency: 'PHP' },
    });

    const updated = await store.updateCheckoutStatus('chk_123', { status: 'paid', environment: 'test' });
    expect(updated).toMatchObject({ aggregateVersion: 2, status: 'paid' });

    const event = {
      environment: 'test',
      provider: 'paymongo',
      providerEventId: 'evt_paid_123',
      eventType: 'payment.checkout.paid',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      aggregateVersion: updated.aggregateVersion,
      payload: { ownerTribeId: 'tribe-alpha', consumerServiceId: 'alphaci-backend', referenceId: 'order-123', aggregateVersion: updated.aggregateVersion },
    };
    await expect(store.enqueuePaymentEvent(event)).resolves.toEqual({ inserted: true, duplicate: false });
    await expect(store.enqueuePaymentEvent(event)).resolves.toEqual({ inserted: false, duplicate: true });
    await expect(store.claimPendingPaymentEvents()).resolves.toEqual([
      expect.objectContaining({ providerEventId: 'evt_paid_123', aggregateVersion: 2 }),
    ]);
  });

  it('executes the state/outbox callback through the transaction boundary', async () => {
    const store = createMemoryPaymentStore();
    const result = await store.withTransaction(async (transaction: unknown) => ({ transaction, committed: true }));
    expect(result).toEqual({ transaction: null, committed: true });
  });
  it('quarantines unattributed events and releases them after attribution is resolved', async () => {
    const store = createMemoryPaymentStore();
    const event = {
      environment: 'test',
      provider: 'paymongo',
      providerEventId: 'evt_unattributed_123',
      eventType: 'payment.checkout.paid',
      aggregateType: 'checkout',
      aggregateId: 'chk_unattributed',
      aggregateVersion: 1,
      payload: {},
    };

    await expect(store.enqueuePaymentEvent(event)).resolves.toEqual({
      inserted: true,
      duplicate: false,
      quarantined: true,
    });
    await expect(store.claimPendingPaymentEvents()).resolves.toEqual([]);
    await expect(store.claimQuarantinedPaymentEvents()).resolves.toEqual([
      expect.objectContaining({ status: 'quarantined', quarantineAttempts: 1 }),
    ]);

    await store.resolveQuarantinedPaymentEvent(event.providerEventId, {
      ownerTribeId: 'tribe-alpha',
      consumerServiceId: 'alphaci-backend',
      referenceId: 'order-123',
    });
    await expect(store.claimPendingPaymentEvents()).resolves.toEqual([
      expect.objectContaining({
        status: 'publishing',
        ownerTribeId: 'tribe-alpha',
        consumerServiceId: 'alphaci-backend',
        referenceId: 'order-123',
      }),
    ]);
  });
});