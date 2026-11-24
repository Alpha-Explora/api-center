import { PayoutCallbackController } from '../../../../apps/gateway/src/domains/gateway-proxy/shared-services/payout-callback.controller';

jest.mock('../../../../apps/gateway/src/shared/proxy/cloud-run-auth', () => ({
  getCloudRunAuthorizationHeader: jest.fn().mockResolvedValue('Bearer google-id-token'),
}));

describe('PayoutCallbackController', () => {
  const saved = { fetch: global.fetch, url: process.env.APICENTER_PAYMENTS_URL, token: process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST };
  const routing = { resolve: jest.fn(() => ({ targetUrl: undefined })) } as any;
  const token = 'A'.repeat(43);
  let calls: Array<{ url: string; init: any }>;

  beforeEach(() => {
    calls = [];
    process.env.APICENTER_PAYMENTS_URL = 'https://payments.internal/';
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = 'runtime-token';
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    }) as any;
  });

  afterAll(() => {
    global.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.APICENTER_PAYMENTS_URL; else process.env.APICENTER_PAYMENTS_URL = saved.url;
    if (saved.token === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;
    else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = saved.token;
  });

  it('forwards only the token, never the body, with the runtime token', async () => {
    await new PayoutCallbackController(routing).forwardPayoutCallback('test', token);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://payments.internal/payouts/callbacks/${token}`);
    expect(calls[0].init.body).toBe('{}');
    expect(calls[0].init.headers).toMatchObject({ 'X-APICenter-Internal-Token': 'runtime-token', 'X-APICenter-Environment': 'test',
      Authorization: 'Bearer google-id-token' });
  });

  it.each([['test', 'short'], ['staging', token], ['test', `${'A'.repeat(42)}!`]])(
    'ignores environment %s with token %s without calling the runtime', async (environment, value) => {
      await expect(new PayoutCallbackController(routing).forwardPayoutCallback(environment, value)).resolves.toBeUndefined();
      expect(calls).toHaveLength(0);
    });

  it('swallows a runtime outage, since the reconcile job settles the payout anyway', async () => {
    global.fetch = jest.fn(async () => { throw new Error('connection refused'); }) as any;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(new PayoutCallbackController(routing).forwardPayoutCallback('test', token)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('apicenter_payout_callback_forward_failed'));
    warn.mockRestore();
  });
});
