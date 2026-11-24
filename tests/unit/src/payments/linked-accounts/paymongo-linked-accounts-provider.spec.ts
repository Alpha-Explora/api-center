import { readFileSync } from 'node:fs';
import { PayMongoLinkedAccountsSandbox } from '../../../../../apps/payments/src/features/linked-accounts/paymongo-linked-accounts-provider';
import { PayMongoError } from '../../../../../apps/payments/src/shared/payment-errors';

const fixtures = JSON.parse(readFileSync('tests/fixtures/paymongo/linked-accounts/sandbox-contract.json', 'utf8'));

describe('PayMongo linked accounts sandbox contract', () => {
  it('reads the static ID and numeric expiry observed on the sandbox', async () => {
    const request = jest.fn().mockResolvedValueOnce(fixtures.create).mockResolvedValueOnce(fixtures.verification);
    const provider = new PayMongoLinkedAccountsSandbox(request);
    await expect(provider.create('lac_fixture')).resolves.toEqual({
      kind: 'ok', value: { providerAccountId: 'org_test_merchant' },
    });
    await expect(provider.issueVerificationLink('org_test_merchant', 'verification-1')).resolves.toEqual({
      kind: 'ok', value: { url: 'https://example.com/verification-fixture', sessionId: 'verif_fixture',
        expiresAt: new Date(1795766400000) },
    });
    expect(request.mock.calls.map(([url, options]) => [url, options.method, Boolean(options.idempotencyKey)])).toEqual([
      ['/v2/accounts', 'POST', true],
      ['/v2/accounts/org_test_merchant/identity_verification', 'POST', true],
    ]);
  });

  it('reports a rate limit separately from an uncertain write', async () => {
    const request = jest.fn().mockRejectedValueOnce(new PayMongoError('Busy', 429))
      .mockRejectedValueOnce(new PayMongoError('Timeout', 408));
    const provider = new PayMongoLinkedAccountsSandbox(request);
    await expect(provider.create('lac_fixture')).resolves.toMatchObject({ kind: 'rejected', code: 'rate_limited' });
    await expect(provider.create('lac_fixture')).resolves.toEqual({ kind: 'unknown' });
    expect(request.mock.calls[0][1].idempotencyKey).toEqual(request.mock.calls[1][1].idempotencyKey);
  });

  it('maps consumer details and activation to the test account fixture', async () => {
    const request = jest.fn().mockResolvedValueOnce({ data: { id: 'org_test_consumer', type: 'consumer' } })
      .mockResolvedValueOnce(fixtures.verification).mockResolvedValue({});
    const provider = new PayMongoLinkedAccountsSandbox(request, 'consumer');
    await expect(provider.create('lac_consumer')).resolves.toMatchObject({
      kind: 'ok', value: { providerAccountId: 'org_test_consumer' },
    });
    await expect(provider.issueVerificationLink('org_test_consumer', 'fixture')).resolves.toMatchObject({
      kind: 'ok', value: { sessionId: 'verif_fixture', expiresAt: new Date(1795766400000) },
    });
    await expect(provider.submitDetails('org_test_consumer', { firstName: 'Test', lastName: 'Payee', email: 'payee@example.test' }))
      .resolves.toMatchObject({ kind: 'ok' });
    await expect(provider.activate('org_test_consumer')).resolves.toMatchObject({ kind: 'ok' });
    expect(request).toHaveBeenNthCalledWith(1, '/v2/accounts', expect.objectContaining({ body: { type: 'consumer' } }));
    expect(request).toHaveBeenNthCalledWith(3, '/v2/accounts/org_test_consumer', expect.objectContaining({
      method: 'PATCH', body: { person: { first_name: 'Test', last_name: 'Payee', email_address: 'payee@example.test' } },
    }));
    expect(request).toHaveBeenNthCalledWith(4, '/v2/accounts/org_test_consumer/activate', expect.objectContaining({ method: 'POST' }));
    await expect(provider.activate('org_test_merchant')).resolves.toEqual({ kind: 'unknown' });
    expect(request).toHaveBeenCalledTimes(4);
  });
});
