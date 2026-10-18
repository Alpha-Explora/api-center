import { RefundsService } from '../../../../apps/payments/src/features/refunds/refunds.service';
import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';
import { paymongoRequest } from '../../../../apps/payments/src/shared/paymongo-client';

jest.mock('../../../../apps/payments/src/shared/paymongo-client', () => ({
  isMockMode: () => false, paymongoRequest: jest.fn(),
}));

describe('refund reconciliation', () => {
  const owner = { tribeId: 'tribe-a', projectId: 'project-a', consumerServiceId: 'service-a', environment: 'test' as const };

  it('retrieves current provider status and rejects a different refund resource', async () => {
    const request = jest.mocked(paymongoRequest);
    request.mockResolvedValueOnce({ data: { id: 'ref_123', attributes: { status: 'processing', amount: 100, currency: 'PHP' } } });
    await expect(new RefundsService().getRefund('ref_123')).resolves.toMatchObject({ status: 'processing', amount: 100 });
    expect(request).toHaveBeenCalledWith('/refunds/ref_123');
    request.mockResolvedValueOnce({ data: { id: 'ref_other', attributes: { status: 'succeeded' } } });
    await expect(new RefundsService().getRefund('ref_123')).rejects.toMatchObject({ code: 'PROVIDER_RESOURCE_MISMATCH' });
  });

  it('persists provider status, rejects foreign owners and preserves terminal refunds', async () => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: 'refund', resourceId: 'ref_123',
      snapshot: { status: 'pending', amount: 100, currency: 'PHP' } });
    await store.reconcileRefund('ref_123', owner, { status: 'processing' });
    const completed = await store.reconcileRefund('ref_123', owner, { status: 'succeeded' });
    expect(completed.status).toBe('succeeded');
    const stale = await store.reconcileRefund('ref_123', owner, { status: 'pending' });
    expect(stale).toEqual(completed);
    await expect(store.reconcileRefund('ref_123', { ...owner, projectId: 'other' }, { status: 'failed' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
