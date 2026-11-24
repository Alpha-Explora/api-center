import { createMerchantAccountResolver, type MerchantAccount } from '../../../../../apps/payments/src/features/payouts/merchant-accounts';
import { paymongoRequest } from '../../../../../apps/payments/src/shared/paymongo-client';
import { PayMongoError } from '../../../../../apps/payments/src/shared/payment-errors';

type QueryResult = { rows: Array<Record<string, unknown>> };

function fakePool(mapping: Array<{ project_id: string; effective_from: string; merchant_account_id: string }>,
  accounts: Array<Record<string, unknown>>) {
  return {
    query: jest.fn(async (sql: string, params: unknown[]): Promise<QueryResult> => {
      if (sql.includes('project_merchant_accounts')) {
        const [environment, projectId, at] = params as [string, string, Date];
        void environment;
        const row = mapping
          .filter((candidate) => candidate.project_id === projectId && Date.parse(candidate.effective_from) <= at.getTime())
          .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
        return { rows: row ? [row] : [] };
      }
      const [, id] = params as [string, string];
      return { rows: accounts.filter((account) => account.id === id) };
    }),
  };
}

describe('merchant-account resolver', () => {
  const parentRow = { id: 'parent', kind: 'parent', wallet_account_number: '1234567', wallet_account_name: 'ALPHAEXPLORA', low_float_alert_centavos: '500' };
  const childRow = { id: 'org_child1', kind: 'child', wallet_account_number: null, wallet_account_name: null, low_float_alert_centavos: '0' };

  it('resolves the parent account when a project has no mapping', async () => {
    const resolver = createMerchantAccountResolver(fakePool([], [parentRow]) as any);
    await expect(resolver.resolve('project-1', 'test', new Date())).resolves.toEqual({
      id: 'parent', kind: 'parent', wallet: { number: '1234567', name: 'ALPHAEXPLORA' }, lowFloatAlert: 500,
    });
  });

  it('resolves the child account in effect at the given time', async () => {
    const resolver = createMerchantAccountResolver(fakePool(
      [{ project_id: 'project-1', effective_from: '2026-12-01T00:00:00Z', merchant_account_id: 'org_child1' }],
      [parentRow, childRow]) as any, { enabledFor: async () => true });
    await expect(resolver.resolve('project-1', 'live', new Date('2026-12-02T00:00:00Z')))
      .resolves.toEqual({ id: 'org_child1', kind: 'child', wallet: null, lowFloatAlert: 0 });
    await expect(resolver.resolve('project-1', 'live', new Date('2026-11-30T00:00:00Z'))).resolves.toMatchObject({ id: 'parent' });
  });

  it('uses the configured wallet in memory mode', async () => {
    process.env.PAYOUT_WALLET_NUMBER = '9876543';
    process.env.PAYOUT_WALLET_NAME = 'TEST WALLET';
    try {
      const resolver = createMerchantAccountResolver();
      await expect(resolver.resolve('project-1', 'test', new Date())).resolves.toEqual({
        id: 'parent', kind: 'parent', wallet: { number: '9876543', name: 'TEST WALLET' }, lowFloatAlert: 0,
      });
    } finally {
      delete process.env.PAYOUT_WALLET_NUMBER;
      delete process.env.PAYOUT_WALLET_NAME;
    }
  });
});

describe('paymongoRequest account header', () => {
  const saved = { mode: process.env.PAYMENT_PROVIDER_MODE, key: process.env.PAYMONGO_SECRET_KEY, fetch: global.fetch };
  let calls: Array<{ url: string; headers: Record<string, string> }>;

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
    calls = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), headers: init.headers });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as any;
  });

  afterEach(() => {
    global.fetch = saved.fetch;
    if (saved.mode === undefined) delete process.env.PAYMENT_PROVIDER_MODE; else process.env.PAYMENT_PROVIDER_MODE = saved.mode;
    if (saved.key === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = saved.key;
  });

  it('acts as a child account only when one is given', async () => {
    const child: MerchantAccount = { id: 'org_x', kind: 'child', wallet: null, lowFloatAlert: 0 };
    const parent: MerchantAccount = { id: 'parent', kind: 'parent', wallet: null, lowFloatAlert: 0 };
    await paymongoRequest('/v2/wallets/', { account: child });
    await paymongoRequest('/v2/wallets/', { account: parent });
    await paymongoRequest('/v2/wallets/');
    expect(calls.map((call) => call.headers['Account-ID'])).toEqual(['org_x', undefined, undefined]);
  });

  it('reports an unreachable provider distinctly from an HTTP error', async () => {
    global.fetch = jest.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }) as any;
    const error = await paymongoRequest('/v2/wallets/').catch((caught) => caught);
    expect(error).toBeInstanceOf(PayMongoError);
    expect(error).toMatchObject({ statusCode: 0, code: 'PROVIDER_UNREACHABLE' });
  });
});
