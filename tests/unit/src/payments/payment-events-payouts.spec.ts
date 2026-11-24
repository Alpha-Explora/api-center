const { toCanonicalPaymentEvent } = require('../../../../apps/payments/src/events/pubsubPublisher');

export {};

describe('payout events on the public contract', () => {
  const owner = { ownerTribeId: 'org-1', ownerProjectId: 'project-1', consumerServiceId: 'app-1' };

  it('publishes only the payee onboarding status and its public IDs', () => {
    const event = toCanonicalPaymentEvent({
      providerEventId: 'payee.onboarding.updated:lac_1:4', eventType: 'payee.onboarding.updated', environment: 'test',
      aggregateType: 'payee_onboarding', aggregateId: 'lac_1', aggregateVersion: 4, ...owner,
      payload: { referenceId: 'first', payeeId: 'pye_1', onboardingId: 'lac_1', status: 'activation_pending',
        attempts: 0, verification: { url: 'https://identity.example.test/session-token' } },
    });
    expect(event).toMatchObject({ aggregateId: 'lac_1', aggregateType: 'payee_onboarding', aggregateVersion: 4,
      referenceId: 'first', applicationId: 'app-1' });
    expect(event.data).toEqual({ payeeId: 'pye_1', onboardingId: 'lac_1', status: 'activation_pending', attempts: 0 });
  });

  it('publishes a payout with its own id and only public fields', () => {
    const event = toCanonicalPaymentEvent({
      providerEventId: 'payment.payout.paid:po_1', eventType: 'payment.payout.paid', environment: 'test',
      aggregateType: 'payout', aggregateId: 'po_1', aggregateVersion: 1, ...owner,
      payload: { ...owner, referenceId: 'ext-1', status: 'paid', payoutId: 'po_1', payeeId: 'pye_1', net: 72_500, fee: 1_000,
        currency: 'PHP', trigger: 'schedule', occurredAt: '2026-11-27T12:05:20.000Z', internalNote: 'never public' },
    });
    expect(event).toMatchObject({ eventType: 'payment.payout.paid', aggregateType: 'payout', aggregateId: 'po_1', referenceId: 'ext-1',
      organizationId: 'org-1', projectId: 'project-1', applicationId: 'app-1', occurredAt: '2026-11-27T12:05:20.000Z' });
    expect(event.data).toEqual({ status: 'paid', payoutId: 'po_1', payeeId: 'pye_1', net: 72_500, fee: 1_000, currency: 'PHP', trigger: 'schedule' });
    expect(event.eventId).toMatch(/^evt_[0-9a-f]{24}$/);
  });

  it('publishes a held allocation with its payment', () => {
    const event = toCanonicalPaymentEvent({
      providerEventId: 'payment.allocation.held:pal_1', eventType: 'payment.allocation.held', environment: 'test',
      aggregateType: 'allocation', aggregateId: 'pal_1', ...owner,
      payload: { ...owner, referenceId: 'ORDER-1', status: 'held', allocationId: 'pal_1', payeeId: 'pye_1', paymentId: 'pay_1',
        amount: 42_500, currency: 'PHP' },
    });
    expect(event.aggregateId).toBe('pal_1');
    expect(event.data).toEqual({ status: 'held', allocationId: 'pal_1', payeeId: 'pye_1', paymentId: 'pay_1', amount: 42_500, currency: 'PHP' });
  });

  it('refuses a held allocation without an amount', () => {
    expect(() => toCanonicalPaymentEvent({
      providerEventId: 'payment.allocation.held:pal_2', eventType: 'payment.allocation.held', environment: 'test',
      aggregateType: 'allocation', aggregateId: 'pal_2', ...owner,
      payload: { ...owner, referenceId: 'ORDER-1', status: 'held', allocationId: 'pal_2', payeeId: 'pye_1', paymentId: 'pay_1' },
    })).toThrow('amount is required');
  });
});
