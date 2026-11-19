import { PaymentIntentsService } from '../../../../apps/payments/src/features/payment-intents/payment-intents.service';

/** PayMongo's answers to the three steps of a GCash intent, recorded per endpoint. */
function provider() {
  const calls: Array<{ endpoint: string; body: any; idempotencyKey?: string }> = [];
  const request = jest.fn(async (endpoint: string, options: { body?: any; idempotencyKey?: string } = {}) => {
    calls.push({ endpoint, body: options.body, idempotencyKey: options.idempotencyKey });
    if (endpoint === '/payment_intents') {
      return { data: { id: 'pi_abc', attributes: { client_key: 'pi_abc_client_x', status: 'awaiting_payment_method' } } };
    }
    if (endpoint === '/payment_methods') return { data: { id: 'pm_gcash_1' } };
    if (endpoint === '/payment_intents/pi_abc/attach') {
      return { data: { id: 'pi_abc', attributes: { status: 'awaiting_next_action', amount: 39900, currency: 'PHP',
        next_action: { type: 'redirect', redirect: { url: 'https://pm.link/gcash/authorize', return_url: 'https://return.example' } } } } };
    }
    if (endpoint === '/payment_intents/pi_abc') {
      return { data: { id: 'pi_abc', attributes: { status: 'awaiting_payment_method', amount: 39900, currency: 'PHP',
        last_payment_error: { failed_code: 'payment_cancelled', failed_message: 'Cancelled in GCash' } } } };
    }
    throw new Error(`unexpected ${endpoint}`);
  });
  return { calls, request };
}

describe('wallet payment intents', () => {
  const input = { referenceId: 'BOOKING-1', amount: 39900, currency: 'PHP', paymentMethod: 'gcash',
    returnUrl: 'https://return.example', billing: { name: 'Juan', email: 'juan@example.com' } };

  it('creates, attaches and returns the GCash redirect in one call', async () => {
    const { calls, request } = provider();
    const result = await new PaymentIntentsService(request as never, () => false).createPaymentIntent(input,
      { idempotencyKey: 'booking-1-attempt-1' });

    expect(result).toMatchObject({ paymentIntentId: 'pi_abc', referenceId: 'BOOKING-1', status: 'awaiting_next_action',
      paymentMethod: 'gcash', nextAction: { type: 'redirect', redirectUrl: 'https://pm.link/gcash/authorize' } });
    expect(calls.map((call) => call.endpoint)).toEqual(['/payment_intents', '/payment_methods', '/payment_intents/pi_abc/attach']);
    expect(calls[0].body.data.attributes).toMatchObject({ payment_method_allowed: ['gcash'], metadata: { referenceId: 'BOOKING-1' } });
    expect(calls[1].body.data.attributes).toEqual({ type: 'gcash', billing: { name: 'Juan', email: 'juan@example.com' } });
    expect(calls[2].body.data.attributes).toEqual({ payment_method: 'pm_gcash_1', client_key: 'pi_abc_client_x',
      return_url: 'https://return.example' });
    // Each step has its own key, derived from the caller's, so a retried request repeats each step once.
    const keys = calls.map((call) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys).not.toContain('booking-1-attempt-1');
  });

  it('rejects a wallet it does not support and an intent without a return link', async () => {
    const { request } = provider();
    const service = new PaymentIntentsService(request as never, () => false);
    await expect(service.createPaymentIntent({ ...input, paymentMethod: 'card' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PAYMENT_METHOD' });
    await expect(service.createPaymentIntent({ ...input, returnUrl: undefined }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_RETURN_URL' });
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a failed attempt as failed, with the reason', async () => {
    const { request } = provider();
    await expect(new PaymentIntentsService(request as never, () => false).getPaymentIntent('pi_abc')).resolves.toMatchObject({
      status: 'failed', lastPaymentError: { code: 'payment_cancelled', message: 'Cancelled in GCash' } });
  });
});
