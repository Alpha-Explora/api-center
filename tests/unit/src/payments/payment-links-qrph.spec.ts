import { PaymentLinksService, QrPhService } from '../../../../apps/payments/src/features/payment-links/payment-links.service';
import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';
import { PayMongoError } from '../../../../apps/payments/src/shared/payment-errors';

describe('payment links and QR Ph', () => {
  it('archives and unarchives a PayMongo payment link with PATCH', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'link_123', attributes: { status: 'archived', active: false } } })
      .mockResolvedValueOnce({ data: { id: 'link_123', attributes: { status: 'active', active: true } } });
    const service = new PaymentLinksService(request as any, () => false);

    await expect(service.setArchived('pl_123', true, 'idem-archive'))
      .resolves.toMatchObject({ paymentLinkId: 'pl_123', status: 'archived' });
    await expect(service.setArchived('pl_123', false, 'idem-unarchive'))
      .resolves.toMatchObject({ paymentLinkId: 'pl_123', status: 'active' });
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
