import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';

describe('PaymentOwnerStore', () => {
  const owner = { tribeId: 'tribe-a', projectId: 'project-a', consumerServiceId: 'service-a', environment: 'test' as const };

  it('permits another service in the same project but denies other tribes and environments', async () => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_1',
      referenceId: 'order-1', snapshot: { checkoutId: 'chk_1', status: 'pending' } });

    await expect(store.assertOwned('checkout', 'chk_1', { ...owner, consumerServiceId: 'service-b' }))
      .resolves.toMatchObject({ resourceId: 'chk_1' });
    await expect(store.findByReference('checkout', 'order-1', owner))
      .resolves.toMatchObject({ resourceId: 'chk_1' });
    await expect(store.assertOwned('checkout', 'chk_1', { ...owner, tribeId: 'tribe-b' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(store.assertOwned('checkout', 'chk_1', { ...owner, environment: 'live' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('denies another project in the same tribe on reads, reference lookups and writes', async () => {
    const store = new PaymentOwnerStore('');
    const otherProject = { ...owner, projectId: 'project-b' };
    await store.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_1',
      referenceId: 'order-1', snapshot: { checkoutId: 'chk_1' } });

    await expect(store.assertOwned('checkout', 'chk_1', otherProject)).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.findByReference('checkout', 'order-1', otherProject)).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.save({ ...otherProject, resourceType: 'checkout', resourceId: 'chk_1', snapshot: {} }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(store.assertOwned('checkout', 'chk_1', owner)).resolves.toMatchObject({ projectId: 'project-a' });
  });
});

