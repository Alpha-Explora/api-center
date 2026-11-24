describe('PayMongo request URLs', () => {
  it.each([
    [undefined, 'https://api.paymongo.com'],
    ['https://proxy.example/paymongo/v1/', 'https://proxy.example/paymongo'],
  ])('keeps the configured base path and uses the endpoint version (%s)', async (base, expected) => {
    const saved = { ...process.env };
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_fixture';
    if (base) process.env.PAYMONGO_BASE_URL = base;
    else delete process.env.PAYMONGO_BASE_URL;
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 }));
    try {
      await jest.isolateModulesAsync(async () => {
        const { paymongoRequest } = await import('../../../../apps/payments/src/shared/paymongo-client');
        await paymongoRequest('/v2/batch_transfers', { method: 'POST' });
        await paymongoRequest('/v2/transfers/transfer_fixture');
        await paymongoRequest('/v2/wallets/?fields=account');
        await paymongoRequest('/checkout_sessions');
      });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `${expected}/v2/batch_transfers`,
        `${expected}/v2/transfers/transfer_fixture`,
        `${expected}/v2/wallets/?fields=account`,
        `${expected}/v1/checkout_sessions`,
      ]);
    } finally {
      fetch.mockRestore();
      for (const key of ['PAYMONGO_BASE_URL', 'PAYMENT_PROVIDER_MODE', 'PAYMONGO_TEST_SECRET_KEY']) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
