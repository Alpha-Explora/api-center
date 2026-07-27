const { paymentEventTopicName, publishPaymentEvent, toCanonicalPaymentEvent } = require('../../../apps/payments/src/events/pubsubPublisher');

describe('payment Pub/Sub publisher contract', () => {
  it('normalizes an outbox row into the public canonical envelope', () => {
    expect(toCanonicalPaymentEvent({
      environment: 'test',
      providerEventId: 'evt_123',
      eventType: 'payment.checkout.paid',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      aggregateVersion: 2,
      payload: {
        ownerTribeId: 'tribe_alpha',
        consumerServiceId: 'svc_alphaci',
        referenceId: 'ACI-123',
        occurredAt: '2026-07-27T10:02:00.000Z',
        status: 'paid',
        checkoutId: 'chk_123',
        amount: { amountMinor: 39900, currency: 'PHP' },
        updated: true,
      },
    })).toEqual({
      eventId: 'evt_123',
      contractVersion: '1.0',
      eventType: 'payment.checkout.paid',
      ownerTribeId: 'tribe_alpha',
      consumerServiceId: 'svc_alphaci',
      referenceId: 'ACI-123',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      aggregateVersion: 2,
      occurredAt: '2026-07-27T10:02:00.000Z',
      data: {
        environment: 'test',
        status: 'paid',
        referenceId: 'ACI-123',
        checkoutId: 'chk_123',
        amount: { amountMinor: 39900, currency: 'PHP' },
        aggregateVersion: 2,
        updated: true,
      },
    });
  });

  it('fails closed when routing identity is missing', () => {
    expect(() => toCanonicalPaymentEvent({
      environment: 'test',
      providerEventId: 'evt_123',
      eventType: 'payment.checkout.paid',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      payload: { referenceId: 'ACI-123', ownerTribeId: 'tribe_alpha' },
    })).toThrow('consumerServiceId is required');
  });
  it('publishes the committed envelope with canonical Pub/Sub attributes', async () => {
    const topic = { publishMessage: jest.fn().mockResolvedValue('msg-123') };
    const event = {
      environment: 'test',
      providerEventId: 'evt_publish_123',
      eventType: 'payment.checkout.paid',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      aggregateVersion: 2,
      payload: {
        ownerTribeId: 'tribe-alpha',
        consumerServiceId: 'alphaci-backend',
        referenceId: 'order-123',
        amount: { amountMinor: 39900, currency: 'PHP' },
      },
    };

    await expect(publishPaymentEvent(event, { topic })).resolves.toEqual({ published: true, messageId: 'msg-123' });
    expect(paymentEventTopicName('test')).toBe('apicenter.payment-events.test');
    expect(topic.publishMessage).toHaveBeenCalledWith(expect.objectContaining({
      attributes: expect.objectContaining({
        eventId: 'evt_publish_123',
        consumerServiceId: 'alphaci-backend',
        referenceId: 'order-123',
        aggregateVersion: '2',
      }),
    }));
  });
});