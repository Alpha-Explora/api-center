const PAYMONGO_BASE_URL =
  process.env.PAYMONGO_BASE_URL || 'https://api.paymongo.com/v1';
const {
  createCircuitBreaker,
  recordProviderMetric,
  withProviderTimeout,
} = require('@apicenter/runtime');
const paymongoCircuit = createCircuitBreaker({
  provider: 'paymongo',
  failureThreshold: Number(process.env.PAYMONGO_PROVIDER_FAILURE_THRESHOLD || 5),
  resetAfterMs: Number(process.env.PAYMONGO_PROVIDER_CIRCUIT_RESET_MS || 30_000),
});

function basicAuthHeader(secretKey) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
}

async function paymongoRequest(
  path,
  {
    method = 'GET',
    body,
    idempotencyKey,
    requireSecretKey,
    PayMongoError,
    fetchImpl = fetch,
  } = {},
) {
  const startedAt = Date.now();
  const operation = `${method} ${path}`;
  let response;

  try {
    response = await paymongoCircuit.exec(() => withProviderTimeout(
      fetchImpl(`${PAYMONGO_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: basicAuthHeader(requireSecretKey()),
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      {
        timeoutMs: Number(process.env.PAYMONGO_PROVIDER_TIMEOUT_MS || 2000),
        provider: 'paymongo',
        operation,
      },
    ));
  } catch (error) {
    recordProviderMetric({
      serviceId: 'paymongo',
      provider: 'paymongo',
      operation,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      code: error.code,
    });
    throw error;
  }

  recordProviderMetric({
    serviceId: 'paymongo',
    provider: 'paymongo',
    operation,
    status: response.ok ? 'success' : 'error',
    latencyMs: Date.now() - startedAt,
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const providerMessage =
      responseBody?.errors?.[0]?.detail ||
      responseBody?.errors?.[0]?.message ||
      responseBody?.error ||
      'PayMongo provider request failed.';

    throw new PayMongoError(providerMessage, 502, responseBody);
  }

  return responseBody;
}

module.exports = { paymongoRequest };

