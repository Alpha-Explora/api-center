import { CustomersCatalogService } from '../../../../apps/payments/src/features/customers-catalog/customers-catalog.service';
import { isMockMode, paymongoRequest } from '../../../../apps/payments/src/shared/paymongo-client';

jest.mock('../../../../apps/payments/src/shared/paymongo-client', () => ({
  isMockMode: jest.fn(),
  paymongoRequest: jest.fn(),
}));

describe('CustomersCatalogService plans', () => {
  const service = new CustomersCatalogService();

  beforeEach(() => {
    jest.clearAllMocks();
    (isMockMode as jest.Mock).mockReturnValue(false);
    (paymongoRequest as jest.Mock).mockResolvedValue({ data: { id: 'plan_abc', attributes: {
      name: 'Quarterly', amount: 150050, currency: 'PHP', interval: 'monthly', interval_count: 3, cycle_count: 4,
    } } });
  });

  it('creates a PayMongo plan with validated schedule fields and returns a plan ID', async () => {
    await expect(service.createPlan({ name: 'Quarterly', amount: 150050, interval: 'monthly',
      intervalCount: 3, cycleCount: 4 }, { idempotencyKey: 'plan-key' })).resolves.toMatchObject({
      planId: 'plan_abc', amount: 150050, interval: 'monthly', intervalCount: 3, cycleCount: 4,
    });
    expect(paymongoRequest).toHaveBeenCalledWith('/subscriptions/plans', expect.objectContaining({
      method: 'POST', idempotencyKey: 'plan-key', body: { data: { attributes: expect.objectContaining({
        amount: 150050, currency: 'PHP', interval: 'monthly', interval_count: 3, cycle_count: 4,
      }) } },
    }));
  });

  it.each([
    [{ name: 'Bad amount', amount: 1999, interval: 'monthly' }],
    [{ name: 'Bad interval', amount: 2000, interval: 'daily' }],
    [{ name: 'Bad interval count', amount: 2000, interval: 'monthly', intervalCount: 11 }],
    [{ name: 'Bad cycle count', amount: 2000, interval: 'monthly', cycleCount: 1 }],
    [{ name: 'Unsafe cycle count', amount: 2000, interval: 'monthly', cycleCount: Number.MAX_VALUE }],
  ])('rejects invalid PayMongo plan fields before making a request', async (input) => {
    await expect(service.createPlan(input)).rejects.toMatchObject({ statusCode: 400 });
    expect(paymongoRequest).not.toHaveBeenCalled();
  });
});
