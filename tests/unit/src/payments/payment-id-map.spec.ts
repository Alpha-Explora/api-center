import { mintPublicId, PUBLIC_ID_PATTERN, PUBLIC_ID_PREFIX } from '../../../../apps/payments/src/shared/payment-id-map';
import { PaymentOwnerStore } from '../../../../apps/payments/src/shared/payment-owner-store';

describe('APICenter payment IDs', () => {
  it('mints a prefixed, 26-character Crockford base32 ID per resource type', () => {
    for (const [type, prefix] of Object.entries(PUBLIC_ID_PREFIX)) {
      const id = mintPublicId(type as keyof typeof PUBLIC_ID_PREFIX);
      expect(id).toMatch(PUBLIC_ID_PATTERN);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
    }
    expect(new Set(Array.from({ length: 1000 }, () => mintPublicId('checkout'))).size).toBe(1000);
  });

  it('never treats a provider ID as a public one', () => {
    expect('cs_9Xc4LmQ2hT7bNvK1pR3sW8yZ').not.toMatch(PUBLIC_ID_PATTERN);
    expect('pay_9Xc4LmQ2hT7bNvK1pR3sW8yZ').not.toMatch(PUBLIC_ID_PATTERN);
  });

  it('resolves both ways and reuses the public ID for a provider resource it already knows', async () => {
    const store = new PaymentOwnerStore('');
    const context = { tribeId: 'org-a', projectId: 'prj-a', consumerServiceId: 'app-a', environment: 'test' as const };
    const minted = await store.publicIdFor('checkout', 'cs_provider1', 'test');
    expect(minted).toMatch(PUBLIC_ID_PATTERN);
    await store.save({ ...context, resourceType: 'checkout', resourceId: minted, providerResourceId: 'cs_provider1', snapshot: {} });
    expect(await store.publicIdFor('checkout', 'cs_provider1', 'test')).toBe(minted);
    expect((await store.findByProviderId('checkout', 'cs_provider1', 'test'))?.resourceId).toBe(minted);
    expect(await store.findByProviderId('checkout', 'cs_provider1', 'live')).toBeUndefined();
    expect((await store.assertOwned('checkout', minted, context)).providerResourceId).toBe('cs_provider1');
  });
});
