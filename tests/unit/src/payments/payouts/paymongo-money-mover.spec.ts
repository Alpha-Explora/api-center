import { PayMongoMoneyMover } from '../../../../../apps/payments/src/features/payouts/paymongo-money-mover';
import { MockMoneyMover } from '../../../../../apps/payments/src/features/payouts/mock-money-mover';
import type { MerchantAccount } from '../../../../../apps/payments/src/features/payouts/merchant-accounts';
import type { TransferRequest } from '../../../../../apps/payments/src/features/payouts/money-mover';

const account: MerchantAccount = { id: 'parent', kind: 'parent', wallet: { number: '1234', name: 'ALPHAEXPLORA' }, lowFloatAlert: 0 };
const request = (overrides: Partial<TransferRequest> = {}): TransferRequest => ({
  account,
  referenceNumber: '7K2M9X',
  amount: 42_500,
  destination: { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan Dela Cruz' },
  metadata: { payoutId: 'po_7k2m9x' },
  callbackUrl: 'https://api.example/cb',
  ...overrides,
});

describe('PayMongo money mover', () => {
  const saved = { mode: process.env.PAYMENT_PROVIDER_MODE, key: process.env.PAYMONGO_SECRET_KEY, fetch: global.fetch };
  let calls: Array<{ url: string; method: string; body: any }>;
  let respond: (url: string) => Response | Promise<Response>;

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
    calls = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return respond(String(url));
    }) as any;
  });

  afterEach(() => {
    global.fetch = saved.fetch;
    if (saved.mode === undefined) delete process.env.PAYMENT_PROVIDER_MODE; else process.env.PAYMENT_PROVIDER_MODE = saved.mode;
    if (saved.key === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = saved.key;
  });

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const created = () => json(201, { data: { id: 'batch_tr_1', transfers: [{ id: 'tr_1', status: 'pending', fee: 1000 }] } });

  it('sends one InstaPay transfer as a batch of one', async () => {
    respond = created;
    await expect(new PayMongoMoneyMover().submit(request()))
      .resolves.toEqual({ kind: 'accepted', transferId: 'tr_1', status: 'pending', fee: 1000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v2\/batch_transfers$/);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ transfers: [{
      source_account: { number: '1234', name: 'ALPHAEXPLORA', bic: 'PAEYPHM2XXX' },
      destination_account: { number: '09171234567', name: 'Juan Dela Cruz', bic: 'GXCHPHM2XXX' },
      amount: 42500, currency: 'PHP', provider: 'instapay', reference_number: '7K2M9X',
      callback_url: 'https://api.example/cb', metadata: { payoutId: 'po_7k2m9x' },
    }] });
  });

  it('sends wallet-to-wallet on the paymongo rail', async () => {
    respond = created;
    await new PayMongoMoneyMover().submit(request({ destination: { type: 'provider_wallet', accountNumber: '5555', accountName: 'Maria' } }));
    expect(calls[0].body.transfers[0]).toMatchObject({ provider: 'paymongo', destination_account: { number: '5555', name: 'Maria', bic: 'PAEYPHM2XXX' } });
  });

  it.each([
    [422, { errors: [{ code: 'unprocessable_entity', detail: 'destination_account: invalid' }] }, { kind: 'rejected', code: 'rejected' }],
    [429, { errors: [{ code: 'too_many_requests', detail: 'slow down' }] }, { kind: 'rejected', code: 'rate_limited' }],
    [500, { errors: [{ code: 'internal_server_error', detail: 'oops' }] }, { kind: 'unknown' }],
    [408, { errors: [{ code: 'request_timeout', detail: 'timed out' }] }, { kind: 'unknown' }],
    [409, { errors: [{ code: 'conflict', detail: 'in progress' }] }, { kind: 'unknown' }],
  ])('maps HTTP %s to its outcome', async (status, body, outcome) => {
    respond = () => json(status, body);
    await expect(new PayMongoMoneyMover().submit(request())).resolves.toMatchObject(outcome);
  });

  it('treats an unreachable provider as an unknown outcome', async () => {
    global.fetch = jest.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }) as any;
    await expect(new PayMongoMoneyMover().submit(request())).resolves.toMatchObject({ kind: 'unknown' });
  });

  it('refuses without a configured wallet and never calls PayMongo', async () => {
    respond = created;
    await expect(new PayMongoMoneyMover().submit(request({ account: { ...account, wallet: null } })))
      .resolves.toMatchObject({ kind: 'rejected', code: 'wallet_not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('looks a transfer up by id', async () => {
    respond = () => json(200, { data: { id: 'tr_1', status: 'succeeded', fee: 1000 } });
    await expect(new PayMongoMoneyMover().lookup(account, { transferId: 'tr_1' }))
      .resolves.toEqual({ found: true, transferId: 'tr_1', status: 'succeeded', fee: 1000, failureCode: null });
    expect(calls[0].url).toMatch(/\/v2\/transfers\/tr_1$/);
  });

  it('looks a transfer up by reference number in recent batches', async () => {
    respond = () => json(200, { data: [
      { id: 'batch_tr_2', transfers: [{ id: 'tr_9', reference_number: 'OTHER', status: 'pending' }] },
      { id: 'batch_tr_1', transfers: [{ id: 'tr_1', reference_number: '7K2M9X', status: 'failed', fee: 0, error_code: 'invalid_destination_account' }] },
    ] });
    await expect(new PayMongoMoneyMover().lookup(account, { referenceNumber: '7K2M9X', since: new Date('2026-11-27T00:00:00Z') }))
      .resolves.toEqual({ found: true, transferId: 'tr_1', status: 'failed', fee: 0, failureCode: 'invalid_destination' });
    expect(calls[0].url).toMatch(/\/v2\/batch_transfers/);
  });

  it('reports a reference it cannot find', async () => {
    respond = () => json(200, { data: [] });
    await expect(new PayMongoMoneyMover().lookup(account, { referenceNumber: 'NOPE', since: new Date() })).resolves.toEqual({ found: false });
  });

  it('reads the available balance of the matching wallet', async () => {
    respond = () => json(200, { data: [
      { id: 'w_other', account: { account_number: '9999' }, balance: { available: 1, pending: 0 } },
      { id: 'w_1', account: { account_number: '1234' }, balance: { available: 1_250_000, pending: 0 } },
    ] });
    await expect(new PayMongoMoneyMover().availableBalance(account)).resolves.toBe(1_250_000);
    expect(calls[0].url).toContain('/v2/wallets/?fields=balance&fields=account');
  });
});

describe('mock money mover', () => {
  it('accepts, then reports success on lookup', async () => {
    const mover = new MockMoneyMover();
    const submitted = await mover.submit(request());
    expect(submitted).toMatchObject({ kind: 'accepted', status: 'pending' });
    if (submitted.kind !== 'accepted') throw new Error('expected accepted');
    await expect(mover.lookup(account, { transferId: submitted.transferId })).resolves.toMatchObject({ found: true, status: 'succeeded' });
    await expect(mover.lookup(account, { referenceNumber: '7K2M9X', since: new Date(0) })).resolves.toMatchObject({ found: true });
  });

  it('can be told to fail the next submission', async () => {
    const mover = new MockMoneyMover();
    mover.failNext('unknown');
    await expect(mover.submit(request())).resolves.toMatchObject({ kind: 'unknown' });
    mover.failNext('rejected');
    await expect(mover.submit(request())).resolves.toMatchObject({ kind: 'rejected' });
    await expect(mover.submit(request())).resolves.toMatchObject({ kind: 'accepted' });
  });

  it('has a settable balance', async () => {
    const mover = new MockMoneyMover();
    mover.setBalance(50_000);
    await expect(mover.availableBalance(account)).resolves.toBe(50_000);
  });
});
