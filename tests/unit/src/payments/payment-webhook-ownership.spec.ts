import { createHmac } from 'node:crypto';
import { WebhooksService } from '../../../../apps/payments/src/features/webhooks/webhooks.service';
import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';

describe('verified payment ownership', () => {
  const owner = { tribeId: 'tribe-a', consumerServiceId: 'service-a', environment: 'test' as const };
  const previousSecret = process.env.PAYMONGO_TEST_WEBHOOK_SECRET;

  beforeEach(() => { process.env.PAYMONGO_TEST_WEBHOOK_SECRET = 'test-webhook-secret'; });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.PAYMONGO_TEST_WEBHOOK_SECRET;
    else process.env.PAYMONGO_TEST_WEBHOOK_SECRET = previousSecret;
  });

  function signed(payload: unknown) {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = '1760000000';
    const signature = createHmac('sha256', 'test-webhook-secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
    return { rawBody, signatureHeader: `t=${timestamp},te=${signature}`, environment: 'test' };
  }

  it('records a paid checkout payment for its source tribe only', async () => {
    const owners = new PaymentOwnerStore('');
    await owners.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_123',
      snapshot: { checkoutId: 'chk_123' } });
    const payload = { data: { attributes: { type: 'checkout_session.payment.paid', livemode: false,
      data: { id: 'cs_123', attributes: { payments: [{ id: 'pay_123', type: 'payment',
        attributes: { status: 'paid', amount: 10000, currency: 'PHP' } }] } } } } };
    await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
      .resolves.toMatchObject({ data: { updated: 1 } });
    await expect(owners.assertOwned('payment', 'pay_123', owner))
      .resolves.toMatchObject({ snapshot: { paymentId: 'pay_123' } });
    await expect(owners.assertOwned('checkout', 'chk_123', owner))
      .resolves.toMatchObject({ snapshot: { status: 'paid', paymentId: 'pay_123' } });
    await expect(owners.assertOwned('payment', 'pay_123', { ...owner, tribeId: 'tribe-b' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects forged and mismatched events without recording a payment', async () => {
    const owners = new PaymentOwnerStore('');
    await owners.save({ ...owner, resourceType: 'intent', resourceId: 'pi_123', snapshot: {} });
    const payload = { data: { attributes: { type: 'payment.paid', livemode: false,
      data: { id: 'pay_456', type: 'payment', attributes: { payment_intent_id: 'pi_123', status: 'paid' } } } } };
    await expect(new WebhooksService(owners).processWebhook(payload, {
      ...signed(payload), signatureHeader: 't=1760000000,te=' + '0'.repeat(64),
    })).rejects.toMatchObject({ statusCode: 401 });
    await expect(owners.assertOwned('payment', 'pay_456', owner)).rejects.toMatchObject({ statusCode: 404 });
    await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
      .resolves.toMatchObject({ data: { updated: 1 } });
  });
});
