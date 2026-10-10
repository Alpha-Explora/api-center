import { PaymentLinksService, QrPhService } from '../../../../apps/payments/src/features/payment-links/payment-links.service';
import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';
import { PayMongoError } from '../../../../apps/payments/src/shared/payment-errors';

describe('payment links and QR Ph', () => {
  // PayMongo returns a flat payment link object inside data.
  const createdLink = (overrides: Record<string, unknown> = {}) => ({ data: { id: 'link_abc', amount: 25000, currency: 'PHP',
    description: 'Order 1', status: 'active', url: 'https://pm.link/abc', reference_number: 'WTV7Ka2',
    created_at: 1760000000, ...overrides } });
  const linkInput = { referenceId: 'ORDER-1', amount: 25000, description: 'Order 1' };

  it('sends the PayMongo create fields with APICenter reference metadata the caller cannot replace', async () => {
    const request = jest.fn().mockResolvedValue(createdLink());
    const service = new PaymentLinksService(request as any, () => false);

    await expect(service.create({ ...linkInput, description: '  Order 1  ', remarks: 'Thanks',
      metadata: { team: 'billing', apicenter_reference_id: 'spoofed' } }, 'idem-link'))
      .resolves.toMatchObject({ paymentLinkId: 'pl_abc', referenceNumber: 'WTV7Ka2', status: 'active',
        active: true, archived: false, createdAt: '2025-10-09T08:53:20.000Z' });
    expect(request).toHaveBeenCalledWith('/payment_links', { method: 'POST', idempotencyKey: 'idem-link',
      body: { amount: 25000, currency: 'PHP', description: 'Order 1', remarks: 'Thanks',
        metadata: { team: 'billing', apicenter_reference_id: 'ORDER-1' } } });
    expect(request.mock.calls[0][1].body).not.toHaveProperty('reference_number');
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['longer than 255 characters', 'x'.repeat(256)],
  ])('rejects a %s description before calling PayMongo', async (_case, description) => {
    const request = jest.fn();
    const service = new PaymentLinksService(request as any, () => false);
    await expect(service.create({ ...linkInput, description }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_DESCRIPTION' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', { count: 1 }],
    ['an object', { nested: { a: 'b' } }],
  ])('rejects metadata with %s value before calling PayMongo', async (_case, metadata) => {
    const request = jest.fn();
    const service = new PaymentLinksService(request as any, () => false);
    await expect(service.create({ ...linkInput, metadata }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_METADATA' });
    expect(request).not.toHaveBeenCalled();
  });

  it('fails the create when PayMongo returns no reference number, because a paid event could never match it', async () => {
    const service = new PaymentLinksService(jest.fn().mockResolvedValue(createdLink({ reference_number: undefined })) as any,
      () => false);
    await expect(service.create(linkInput))
      .rejects.toMatchObject({ statusCode: 502, code: 'INVALID_PROVIDER_RESPONSE' });
  });

  it('generates a reference number in mock mode', async () => {
    const service = new PaymentLinksService(jest.fn() as any, () => true);
    const first = await service.create(linkInput);
    const second = await service.create(linkInput);
    expect(first.referenceNumber).toMatch(/^mock[0-9a-f]{12}$/);
    expect(second.referenceNumber).not.toBe(first.referenceNumber);
  });

  it('archives and unarchives a PayMongo payment link with PATCH and derives the flags from status', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'link_123', status: 'archived' } })
      .mockResolvedValueOnce({ data: { id: 'link_123', status: 'active' } });
    const service = new PaymentLinksService(request as any, () => false);

    await expect(service.setArchived('pl_123', true, 'idem-archive'))
      .resolves.toMatchObject({ paymentLinkId: 'pl_123', status: 'archived', active: false, archived: true });
    await expect(service.setArchived('pl_123', false, 'idem-unarchive'))
      .resolves.toMatchObject({ paymentLinkId: 'pl_123', status: 'active', active: true, archived: false });
    expect(request).toHaveBeenNthCalledWith(1, '/payment_links/link_123',
      expect.objectContaining({ method: 'PATCH', body: { archive: true }, idempotencyKey: 'idem-archive' }));
    expect(request).toHaveBeenNthCalledWith(2, '/payment_links/link_123',
      expect.objectContaining({ method: 'PATCH', body: { archive: false }, idempotencyKey: 'idem-unarchive' }));
  });

  it('rejects QR Ph expiry outside the provider range before making a PayMongo call', async () => {
    const request = jest.fn();
    const service = new QrPhService(request as any, () => false);
    await expect(service.create({ referenceId: 'ORDER-1', amount: 1000, expirySeconds: 59 }))
      .rejects.toBeInstanceOf(PayMongoError);
    await expect(service.create({ referenceId: 'ORDER-1', amount: 1000, expirySeconds: 9001 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_EXPIRY' });
    expect(request).not.toHaveBeenCalled();
  });

  it('creates the intent, QR payment method, and attachment in one QR Ph call', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'pi_123', attributes: { client_key: 'client_key' } } })
      .mockResolvedValueOnce({ data: { id: 'pm_123' } })
      .mockResolvedValueOnce({ data: { id: 'pi_123', attributes: { status: 'awaiting_next_action',
        next_action: { code: { image_url: 'data:image/png;base64,cXJwaA==' } } } } });
    const service = new QrPhService(request as any, () => false);
    await expect(service.create({ referenceId: 'ORDER-2', amount: 1200, expirySeconds: 300 }, 'idem-qr'))
      .resolves.toMatchObject({ paymentIntentId: 'pi_123', status: 'awaiting_next_action',
        qrCodeImageUrl: 'data:image/png;base64,cXJwaA==', expirySeconds: 300 });
    expect(request).toHaveBeenNthCalledWith(1, '/payment_intents', expect.objectContaining({
      method: 'POST', body: { data: { attributes: { amount: 1200, currency: 'PHP', payment_method_allowed: ['qrph'], metadata: { referenceId: 'ORDER-2' } } } },
    }));
    expect(request).toHaveBeenNthCalledWith(2, '/payment_methods', expect.objectContaining({
      body: { data: { attributes: { type: 'qrph', expiry_seconds: 300 } } },
    }));
    expect(request).toHaveBeenNthCalledWith(3, '/payment_intents/pi_123/attach', expect.objectContaining({
      body: { data: { attributes: { payment_method: 'pm_123', client_key: 'client_key' } } },
    }));
  });

  it('lists payment links only for the owning project', async () => {
    const owners = new PaymentOwnerStore('');
    const context = { tribeId: 'tribe', projectId: 'project-a', consumerServiceId: 'service', environment: 'test' as const };
    await owners.save({ ...context, resourceType: 'payment_link', resourceId: 'pl_1', referenceId: 'A', snapshot: { paymentLinkId: 'pl_1' } });
    await owners.save({ ...context, projectId: 'project-b', resourceType: 'payment_link', resourceId: 'pl_2', referenceId: 'B', snapshot: { paymentLinkId: 'pl_2' } });
    await expect(owners.listOwned(context, 'payment_link')).resolves.toEqual([{ paymentLinkId: 'pl_1' }]);
    await expect(owners.assertOwned('payment_link', 'pl_2', context)).rejects.toMatchObject({ statusCode: 404 });
  });
});
