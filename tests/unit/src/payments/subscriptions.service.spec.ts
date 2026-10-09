import { SubscriptionsService } from '../../../../apps/payments/src/features/subscriptions/subscriptions.service';
import { isMockMode, paymongoRequest } from '../../../../apps/payments/src/shared/paymongo-client';

jest.mock('../../../../apps/payments/src/shared/paymongo-client', () => ({
  isMockMode: jest.fn(),
  paymongoRequest: jest.fn(),
}));

describe('SubscriptionsService plan references', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isMockMode as jest.Mock).mockReturnValue(false);
    (paymongoRequest as jest.Mock).mockResolvedValue({ data: { id: 'sub_123', attributes: { status: 'active' } } });
  });

  it('sends planId to PayMongo as plan_id', async () => {
    const service = new SubscriptionsService();
    await expect(service.createSubscription({ customerId: 'cus_123', planId: 'plan_123' }))
      .resolves.toMatchObject({ customerId: 'cus_123', planId: 'plan_123' });
    expect(paymongoRequest).toHaveBeenCalledWith('/subscriptions', expect.objectContaining({
      method: 'POST', body: { data: { attributes: { customer_id: 'cus_123', plan_id: 'plan_123' } } },
    }));
  });

  it('requires planId before calling PayMongo', async () => {
    const service = new SubscriptionsService();
    await expect(service.createSubscription({ customerId: 'cus_123' })).rejects.toMatchObject({ statusCode: 400 });
    expect(paymongoRequest).not.toHaveBeenCalled();
  });
});
