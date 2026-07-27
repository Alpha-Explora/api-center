export {};
const { replayPaymentEvent } = require('../../../apps/payments/src/events/paymentEventReplay');

describe('payment event replay', () => {
  it('replays the committed snapshot with the original event identity', async () => {
    const publish = jest.fn().mockResolvedValue({ published: true, messageId: 'msg-1' });
    const event = {
      providerEventId: 'evt_replay_123',
      eventType: 'payment.checkout.paid',
      aggregateType: 'checkout',
      aggregateId: 'chk_123',
      aggregateVersion: 4,
      environment: 'test',
      payload: {
        ownerTribeId: 'tribe-alpha',
        consumerServiceId: 'alphaci-backend',
        referenceId: 'order-123',
      },
    };

    await expect(replayPaymentEvent(event, { publish })).resolves.toEqual({
      published: true,
      messageId: 'msg-1',
    });
    expect(publish).toHaveBeenCalledWith(event);
  });
});