import { parsePaymentEvent } from '../../src/payment/events';

describe('parsePaymentEvent', () => {
  it('parses the canonical event envelope and preserves aggregate version', () => {
    const event = parsePaymentEvent({
      eventId: 'evt_123',
      contractVersion: '1.0',
      eventType: 'payment.checkout.paid',
      ownerTribeId: 'alphaci',
      consumerServiceId: 'alphaci-backend',
      referenceId: 'ACI-123',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      aggregateVersion: 3,
      occurredAt: '2026-07-28T03:00:00.000Z',
      data: {
        checkoutId: 'chk_123',
        referenceId: 'ACI-123',
        status: 'paid',
        aggregateVersion: 3,
        amount: { amountMinor: 39900, currency: 'PHP' },
      },
    });

    expect(event.aggregateVersion).toBe(3);
    expect(event.data.status).toBe('paid');
  });

  it('rejects an event whose snapshot version disagrees with its envelope', () => {
    expect(() =>
      parsePaymentEvent({
        eventId: 'evt_123',
        contractVersion: '1.0',
        eventType: 'payment.checkout.paid',
        ownerTribeId: 'alphaci',
        consumerServiceId: 'alphaci-backend',
        referenceId: 'ACI-123',
        aggregateType: 'checkout',
        aggregateId: 'chk_123',
        aggregateVersion: 3,
        occurredAt: '2026-07-28T03:00:00.000Z',
        data: { aggregateVersion: 2 },
      }),
    ).toThrow(/aggregateVersion/);
  });
});
