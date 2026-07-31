import { createCircuitBreaker, withProviderTimeout, recordProviderMetric } from '@apicenter/runtime';

const providerTimeoutMs = Number(process.env.GAUTH_PROVIDER_TIMEOUT_MS || 2000);
const googleAuthCircuit = createCircuitBreaker({
  provider: 'google_oauth',
  failureThreshold: Number(process.env.GAUTH_PROVIDER_FAILURE_THRESHOLD || 5),
  resetAfterMs: Number(process.env.GAUTH_PROVIDER_CIRCUIT_RESET_MS || 30_000),
});

export async function callGoogleProvider(operation: string, url: string, options: any): Promise<any> {
  const startedAt = Date.now();
  try {
    const response = await googleAuthCircuit.exec(() => withProviderTimeout(
      fetch(url, options),
      {
        timeoutMs: providerTimeoutMs,
        provider: 'google_oauth',
        operation,
      },
    ));
    recordProviderMetric({
      serviceId: 'gauth',
      provider: 'google_oauth',
      operation,
      status: response.ok ? 'success' : 'error',
      latencyMs: Date.now() - startedAt,
    });
    return response;
  } catch (error: any) {
    recordProviderMetric({
      serviceId: 'gauth',
      provider: 'google_oauth',
      operation,
      status: 'error',
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
}
