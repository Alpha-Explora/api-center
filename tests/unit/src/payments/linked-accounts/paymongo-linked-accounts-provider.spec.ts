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
});
