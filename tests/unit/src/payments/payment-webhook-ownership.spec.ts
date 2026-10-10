import { createHmac } from 'node:crypto';
import { WebhooksService } from '../../../../apps/payments/src/features/webhooks/webhooks.service';
import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';

describe('verified payment ownership', () => {
  const owner = { tribeId: 'tribe-a', projectId: 'project-a', consumerServiceId: 'service-a', environment: 'test' as const };
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
    await owners.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_123', referenceId: 'ORDER-0',
      snapshot: { checkoutId: 'chk_123' } });
    const payload = { data: { id: 'evt_paid_1', attributes: { type: 'checkout_session.payment.paid', livemode: false,
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

  it('keeps the project of the checkout a webhook updates and hides that payment from another project', async () => {
    const owners = new PaymentOwnerStore('');
    await owners.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_123', referenceId: 'ORDER-0',
      snapshot: { checkoutId: 'chk_123' } });
    const payload = { data: { id: 'evt_paid_project', attributes: { type: 'checkout_session.payment.paid', livemode: false,
      data: { id: 'cs_123', attributes: { payments: [{ id: 'pay_123', type: 'payment',
        attributes: { status: 'paid', amount: 10000, currency: 'PHP' } }] } } } } };
    await new WebhooksService(owners).processWebhook(payload, signed(payload));

    await expect(owners.assertOwned('payment', 'pay_123', owner))
      .resolves.toMatchObject({ projectId: 'project-a' });
    await expect(owners.assertOwned('payment', 'pay_123', { ...owner, projectId: 'project-b' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects forged and mismatched events without recording a payment', async () => {
    const owners = new PaymentOwnerStore('');
    await owners.save({ ...owner, resourceType: 'intent', resourceId: 'pi_123', snapshot: {} });
    const payload = { data: { id: 'evt_paid_2', attributes: { type: 'payment.paid', livemode: false,
      data: { id: 'pay_456', type: 'payment', attributes: { payment_intent_id: 'pi_123', status: 'paid' } } } } };
    await expect(new WebhooksService(owners).processWebhook(payload, {
      ...signed(payload), signatureHeader: 't=1760000000,te=' + '0'.repeat(64),
    })).rejects.toMatchObject({ statusCode: 401 });
    await expect(owners.assertOwned('payment', 'pay_456', owner)).rejects.toMatchObject({ statusCode: 404 });
    await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
      .resolves.toMatchObject({ data: { updated: 1 } });
  });

  describe('payment event outbox', () => {
    const checkoutPaid = (eventId: string, amount = 10000) => ({ data: { id: eventId, attributes: {
      type: 'checkout_session.payment.paid', livemode: false, created_at: 1760000000,
      data: { id: 'cs_123', attributes: { payments: [{ id: 'pay_123', type: 'payment',
        attributes: { status: 'paid', amount, currency: 'php' } }] } } } } });

    async function ownersWithCheckout(referenceId: string | null = 'ORDER-1') {
      const owners = new PaymentOwnerStore('');
      await owners.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_123', referenceId: referenceId ?? undefined,
        snapshot: { checkoutId: 'chk_123' } });
      return owners;
    }

    it('queues one paid-checkout event with the owner identity and the checkout version', async () => {
      const owners = await ownersWithCheckout();
      const payload = checkoutPaid('evt_1');
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .resolves.toMatchObject({ event: 'processed', data: { updated: 1, queued: true } });

      expect(owners.queuedEvents()).toEqual([expect.objectContaining({
        providerEventId: 'evt_1', eventType: 'payment.checkout.paid', aggregateType: 'checkout',
        aggregateId: 'chk_123', aggregateVersion: 2, ownerTribeId: 'tribe-a', ownerProjectId: 'project-a',
        consumerServiceId: 'service-a', referenceId: 'ORDER-1',
        payload: expect.objectContaining({ checkoutId: 'chk_123', paymentId: 'pay_123', amount: 10000,
          currency: 'PHP', status: 'paid', occurredAt: '2025-10-09T08:53:20.000Z' }),
      })]);
    });

    it('does not update state or queue a second event when a provider event is delivered twice', async () => {
      const owners = await ownersWithCheckout();
      const webhooks = new WebhooksService(owners);
      const payload = checkoutPaid('evt_1');
      await webhooks.processWebhook(payload, signed(payload));

      await expect(webhooks.processWebhook(payload, signed(payload)))
        .resolves.toMatchObject({ event: 'duplicate', data: { updated: 0, queued: false } });
      expect(owners.queuedEvents()).toHaveLength(1);
      await expect(owners.assertOwned('checkout', 'chk_123', owner))
        .resolves.toMatchObject({ aggregateVersion: 2 });
    });

    it('rejects a provider event ID reused with different content', async () => {
      const owners = await ownersWithCheckout();
      const webhooks = new WebhooksService(owners);
      const first = checkoutPaid('evt_1');
      await webhooks.processWebhook(first, signed(first));

      const tampered = checkoutPaid('evt_1', 99900);
      await expect(webhooks.processWebhook(tampered, signed(tampered)))
        .rejects.toMatchObject({ statusCode: 409, code: 'WEBHOOK_REPLAY_MISMATCH' });
      expect(owners.queuedEvents()).toHaveLength(1);
    });

    it('marks the checkout paid but queues nothing when it has no merchant reference', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const owners = await ownersWithCheckout(null);
        const payload = checkoutPaid('evt_1');
        await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
          .resolves.toMatchObject({ data: { updated: 1, queued: false } });

        expect(owners.queuedEvents()).toHaveLength(0);
        await expect(owners.assertOwned('checkout', 'chk_123', owner))
          .resolves.toMatchObject({ snapshot: { status: 'paid' } });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('needs_reconciliation'));
      } finally { warn.mockRestore(); }
    });

    it('queues no event for a payment-intent payment', async () => {
      const owners = new PaymentOwnerStore('');
      await owners.save({ ...owner, resourceType: 'intent', resourceId: 'pi_123', referenceId: 'ORDER-1', snapshot: {} });
      const payload = { data: { id: 'evt_2', attributes: { type: 'payment.paid', livemode: false,
        data: { id: 'pay_456', type: 'payment', attributes: { payment_intent_id: 'pi_123', status: 'paid', amount: 5000 } } } } };
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .resolves.toMatchObject({ data: { updated: 1, queued: false } });
      expect(owners.queuedEvents()).toHaveLength(0);
    });

    it('rejects a signed event that has no event ID', async () => {
      const owners = await ownersWithCheckout();
      const payload = { data: { attributes: checkoutPaid('x').data.attributes } };
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_WEBHOOK_EVENT' });
    });
  });

  describe('paid payment links', () => {
    const projectB = { ...owner, projectId: 'project-b', consumerServiceId: 'service-b' };

    // PayMongo's documented payment.paid event for a payment made through a payment link.
    const linkPaymentPaid = (eventId: string, reference: string, attributes: Record<string, unknown> = {}, type = 'payment.paid') => ({
      data: { id: eventId, type: 'event', attributes: { type, livemode: false, created_at: 1760000000,
        data: { id: 'pay_link_1', type: 'payment', attributes: { amount: 25000, currency: 'PHP', status: 'paid',
          origin: 'links', payment_intent_id: 'pi_paymongo_link', external_reference_number: reference,
          metadata: { pm_reference_number: reference }, ...attributes } } } } });

    // Project A's link has PayMongo reference PMREF-A. Project B chose PMREF-UNSAVED as its own referenceId.
    async function ownersWithLinks() {
      const owners = new PaymentOwnerStore('');
      await owners.save({ ...owner, resourceType: 'payment_link', resourceId: 'pl_a', referenceId: 'ORDER-A',
        providerReference: 'PMREF-A', snapshot: { paymentLinkId: 'pl_a', status: 'active' } });
      await owners.save({ ...projectB, resourceType: 'payment_link', resourceId: 'pl_b', referenceId: 'PMREF-UNSAVED',
        providerReference: 'PMREF-B', snapshot: { paymentLinkId: 'pl_b', status: 'active' } });
      return owners;
    }

    it('marks paid only the link whose saved PayMongo reference matches the payment', async () => {
      const owners = await ownersWithLinks();
      const payload = linkPaymentPaid('evt_link_1', 'PMREF-A');
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .resolves.toEqual({ event: 'processed', data: { eventType: 'payment.paid', updated: 1 } });

      await expect(owners.assertOwned('payment_link', 'pl_a', owner))
        .resolves.toMatchObject({ status: 'paid', aggregateVersion: 2, snapshot: { status: 'paid', paymentId: 'pay_link_1' } });
      await expect(owners.assertOwned('payment_link', 'pl_b', projectB))
        .resolves.toMatchObject({ status: 'active', aggregateVersion: 1 });
    });

    it('ignores a reference that matches no saved link, even when another project uses it as a referenceId', async () => {
      const owners = await ownersWithLinks();
      const payload = linkPaymentPaid('evt_link_2', 'PMREF-UNSAVED');
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .resolves.toMatchObject({ event: 'ignored' });

      await expect(owners.assertOwned('payment_link', 'pl_b', projectB))
        .resolves.toMatchObject({ status: 'active', aggregateVersion: 1, snapshot: { status: 'active' } });
    });

    it('treats a replayed paid event as a duplicate that changes nothing', async () => {
      const owners = await ownersWithLinks();
      const webhooks = new WebhooksService(owners);
      const payload = linkPaymentPaid('evt_link_3', 'PMREF-A');
      await webhooks.processWebhook(payload, signed(payload));
      const afterFirst = await owners.assertOwned('payment_link', 'pl_a', owner);

      await expect(webhooks.processWebhook(payload, signed(payload)))
        .resolves.toEqual({ event: 'duplicate', data: { eventType: 'payment.paid', updated: 0 } });
      await expect(owners.assertOwned('payment_link', 'pl_a', owner)).resolves.toEqual(afterFirst);
    });

    it('routes a link payment past the intent lookup, because its payment intent belongs to PayMongo', async () => {
      const owners = await ownersWithLinks();
      await owners.save({ ...owner, resourceType: 'intent', resourceId: 'pi_paymongo_link', snapshot: {} });
      const payload = linkPaymentPaid('evt_link_4', 'PMREF-A');
      await new WebhooksService(owners).processWebhook(payload, signed(payload));

      await expect(owners.assertOwned('payment_link', 'pl_a', owner)).resolves.toMatchObject({ status: 'paid' });
      await expect(owners.assertOwned('intent', 'pi_paymongo_link', owner)).resolves.toMatchObject({ aggregateVersion: 1 });
    });

    it('reads metadata.pm_reference_number when a link.payment.paid payment has no external reference', async () => {
      const owners = await ownersWithLinks();
      const payload = linkPaymentPaid('evt_link_5', 'PMREF-A', { external_reference_number: null }, 'link.payment.paid');
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .resolves.toMatchObject({ event: 'processed', data: { updated: 1 } });
      await expect(owners.assertOwned('payment_link', 'pl_a', owner))
        .resolves.toMatchObject({ snapshot: { status: 'paid', paymentId: 'pay_link_1' } });
    });

    it('matches a link.payment.paid link object by its PayMongo link ID', async () => {
      const owners = await ownersWithLinks();
      const payload = { data: { id: 'evt_link_6', type: 'event', attributes: { type: 'link.payment.paid', livemode: false,
        data: { id: 'link_a', type: 'link', attributes: { status: 'active', reference_number: 'PMREF-UNSAVED',
          payments: [{ data: { id: 'pay_link_6', type: 'payment', attributes: { status: 'paid' } } }] } } } } };
      await expect(new WebhooksService(owners).processWebhook(payload, signed(payload)))
        .resolves.toMatchObject({ event: 'processed', data: { updated: 1 } });

      await expect(owners.assertOwned('payment_link', 'pl_a', owner))
        .resolves.toMatchObject({ snapshot: { status: 'paid', paymentId: 'pay_link_6' } });
      await expect(owners.assertOwned('payment_link', 'pl_b', projectB)).resolves.toMatchObject({ status: 'active' });
    });
  });
});
