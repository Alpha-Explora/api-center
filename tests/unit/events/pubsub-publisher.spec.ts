const { paymentEventTopicName, publishPaymentEvent, toCanonicalPaymentEvent } = require('../../../apps/payments/src/events/pubsubPublisher');

// An outbox row as the dispatcher claims it: the owner is stored as owner_tribe_id (the
// organization), project_id and consumer_service_id (the application).
const row = {
  environment: 'test',
  providerEventId: 'evt_123',
  eventType: 'payment.checkout.paid',
  aggregateType: 'checkout',
  aggregateId: 'chk_v1_Y2hrXzEyMw',
  aggregateVersion: 2,
  ownerTribeId: 'org_1',
  ownerProjectId: 'prj_1',
  consumerServiceId: 'app_1',
  payload: {
    ownerTribeId: 'org_1',
    ownerProjectId: 'prj_1',
    consumerServiceId: 'app_1',
    referenceId: 'ORDER-123',
    occurredAt: '2026-11-19T10:02:00.000Z',
    status: 'paid',
    checkoutId: 'chk_v1_Y2hrXzEyMw',
    paymentId: 'pay_v1_cGF5XzEyMw',
    amount: 39900,
    currency: 'PHP',
    updated: true,
  },
};

describe('payment Pub/Sub publisher contract', () => {
  it('turns an outbox row into a contract 2.0 event', () => {
    expect(toCanonicalPaymentEvent(row)).toEqual({
      eventId: 'evt_123',
      contractVersion: '2.0',
      eventType: 'payment.checkout.paid',
      environment: 'test',
      organizationId: 'org_1',
      projectId: 'prj_1',
      applicationId: 'app_1',
      referenceId: 'ORDER-123',
      aggregateType: 'checkout',
      aggregateId: 'chk_v1_Y2hrXzEyMw',
      aggregateVersion: 2,
      occurredAt: '2026-11-19T10:02:00.000Z',
      data: {
        status: 'paid',
        checkoutId: 'chk_v1_Y2hrXzEyMw',
        paymentId: 'pay_v1_cGF5XzEyMw',
        amount: 39900,
        currency: 'PHP',
      },
    });
  });

  it('publishes an intent event as a payment_intent with its failure reason', () => {
    const failed = { ...row, eventType: 'payment.intent.failed', aggregateType: 'intent', aggregateId: 'pi_abc',
      payload: { ...row.payload, checkoutId: undefined, paymentIntentId: 'pi_abc', status: 'failed',
        failureCode: 'payment_cancelled', failureMessage: 'Cancelled in GCash' } };
    expect(toCanonicalPaymentEvent(failed)).toMatchObject({
      eventType: 'payment.intent.failed', aggregateType: 'payment_intent', aggregateId: 'pi_abc',
      data: { status: 'failed', paymentIntentId: 'pi_abc', paymentId: 'pay_v1_cGF5XzEyMw', amount: 39900,
        currency: 'PHP', failureCode: 'payment_cancelled', failureMessage: 'Cancelled in GCash' },
    });
  });

  it('fails closed when the owner or application is missing', () => {
    const { consumerServiceId: _application, ...withoutApplication } = row;
    expect(() => toCanonicalPaymentEvent({ ...withoutApplication, payload: { ...row.payload, consumerServiceId: undefined } })).toThrow('application is required');
    expect(() => toCanonicalPaymentEvent({ ...row, ownerProjectId: undefined, payload: { ...row.payload, ownerProjectId: undefined } })).toThrow('project is required');
  });

  it('publishes the event with the attributes subscriptions filter on', async () => {
    const topic = { publishMessage: jest.fn().mockResolvedValue('msg-123') };
    await expect(publishPaymentEvent(row, { topic })).resolves.toEqual({ published: true, messageId: 'msg-123' });
    expect(paymentEventTopicName('test')).toBe('apicenter.payment-events.test');
    const message = topic.publishMessage.mock.calls[0][0];
    expect(message.json).toEqual(toCanonicalPaymentEvent(row));
    expect(message.attributes).toEqual({
      eventId: 'evt_123',
      eventType: 'payment.checkout.paid',
      contractVersion: '2.0',
      environment: 'test',
      aggregateType: 'checkout',
      aggregateId: 'chk_v1_Y2hrXzEyMw',
      aggregateVersion: '2',
      organizationId: 'org_1',
      projectId: 'prj_1',
      applicationId: 'app_1',
      consumerServiceId: 'app_1',
      referenceId: 'ORDER-123',
    });
  });
});
