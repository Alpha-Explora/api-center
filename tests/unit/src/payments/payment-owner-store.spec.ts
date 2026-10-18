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

  it('lists durable facts with filters, cursors, and project isolation', async () => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: 'payment', resourceId: 'pay_1',
      createdAt: '2026-10-10T02:00:00.000Z', snapshot: { amount: 1234, currency: 'php', status: 'PAID' } });
    await store.save({ ...owner, resourceType: 'payment', resourceId: 'pay_2',
      createdAt: '2026-10-10T01:00:00.000Z', snapshot: { amount: 567, currency: 'PHP', status: 'paid' } });
    await store.save({ ...owner, resourceType: 'refund', resourceId: 'ref_1',
      snapshot: { amount: 200, currency: 'PHP', status: 'Succeeded' } });
    await store.save({ ...owner, projectId: 'project-b', resourceType: 'payment', resourceId: 'pay_other',
      snapshot: { amount: 99, currency: 'PHP', status: 'paid' } });

    const payments = await store.listRecords(owner, { type: 'payment', status: 'paid', limit: 1 });
    expect(payments.records).toHaveLength(1);
    expect(payments.records[0]).toMatchObject({ type: 'payment', id: 'pay_1', amountMinor: '1234', currency: 'PHP', status: 'paid' });
    expect(payments.records[0].projectId).toBe('project-a');
    expect(payments.nextCursor).toBeDefined();
    await expect(store.listRecords(owner, { type: 'payment', status: 'paid', limit: 1, cursor: payments.nextCursor }))
      .resolves.toMatchObject({ records: [{ id: 'pay_2' }] });
    await expect(store.listRecords({ ...owner, projectId: 'project-b' }, { type: 'payment' }))
      .resolves.toMatchObject({ records: [{ id: 'pay_other' }] });
  });

  it('rejects malformed listing cursors', async () => {
    const store = new PaymentOwnerStore('');
    await expect(store.listRecords(owner, { cursor: 'bad' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('clears a completed intent redirect and keeps repeated reads at the same version', async () => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: 'intent', resourceId: 'pi_1',
      referenceId: 'order-1', snapshot: { status: 'awaiting_next_action', clientKey: 'client-key',
        nextAction: { type: 'redirect', redirectUrl: 'https://provider.example/authorize' } } });
    const completed = await store.reconcileFreshRead('intent', 'pi_1', owner, { status: 'succeeded', nextAction: undefined });
    expect(completed.snapshot).not.toHaveProperty('nextAction');
    expect(completed).toMatchObject({ referenceId: 'order-1', aggregateVersion: 2,
      snapshot: { status: 'succeeded', clientKey: 'client-key' } });
    const repeated = await store.reconcileFreshRead('intent', 'pi_1', owner, { status: 'succeeded' });
    expect(repeated.aggregateVersion).toBe(2);
    const stale = await store.reconcileFreshRead('intent', 'pi_1', owner, {
      status: 'awaiting_next_action', nextAction: { type: 'redirect', redirectUrl: 'https://provider.example/stale' } });
    expect(stale.snapshot).not.toHaveProperty('nextAction');
    expect(stale.status).toBe('succeeded');
    expect(stale.aggregateVersion).toBe(2);
  });

  it.each(['subscription', 'invoice'] as const)('preserves the version of an unchanged %s read', async (type) => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: type, resourceId: 'resource-1',
      snapshot: { status: 'pending', amount: 100, currency: 'PHP' } });
    const record = await store.reconcileFreshRead(type, 'resource-1', owner,
      { currency: 'PHP', amount: 100, status: 'pending' });
    expect(record.aggregateVersion).toBe(1);
  });

  it('lists plan snapshots for only the calling project and environment', async () => {
    const store = new PaymentOwnerStore('');
    await store.save({ ...owner, resourceType: 'plan', resourceId: 'plan_a', snapshot: { planId: 'plan_a' } });
    await store.save({ ...owner, projectId: 'project-b', resourceType: 'plan', resourceId: 'plan_b', snapshot: { planId: 'plan_b' } });
    await store.save({ ...owner, environment: 'live', resourceType: 'plan', resourceId: 'plan_live', snapshot: { planId: 'plan_live' } });

    await expect(store.listOwned(owner, 'plan')).resolves.toEqual([{ planId: 'plan_a' }]);
  });
});

