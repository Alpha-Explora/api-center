import { PayMongoError } from './payment-errors';

const baseUrl = process.env.PAYMONGO_BASE_URL || 'https://api.paymongo.com/v1';

function secretKey(): string {
  const mode = process.env.PAYMENT_PROVIDER_MODE;
  return (mode === 'live' ? process.env.PAYMONGO_LIVE_SECRET_KEY : process.env.PAYMONGO_TEST_SECRET_KEY)
    || process.env.PAYMONGO_SECRET_KEY || '';
}

export function isMockMode(): boolean {
  if (process.env.PAYMENT_PROVIDER_MODE === 'mock') {
    if (process.env.NODE_ENV === 'production') throw new Error('Mock payments are forbidden in production');
    return true;
  }
  if (!secretKey()) {
    if (process.env.NODE_ENV === 'production') throw new Error('PayMongo secret key is required in production');
    return true;
  }
  return false;
}

export function providerMode(): string {
  if (isMockMode()) return 'mock';
  return process.env.PAYMENT_PROVIDER_MODE === 'test' ? 'test' : 'live';
}

export function getAuthHeader(): string {
  const encoded = Buffer.from(`${secretKey()}:`).toString('base64');
  return `Basic ${encoded}`;
}

export async function paymongoRequest(endpoint: string, options: { method?: string; body?: any; idempotencyKey?: string } = {}): Promise<any> {
  if (isMockMode()) {
    return { data: { id: `mock_${Date.now()}`, attributes: { status: 'succeeded' } } };
  }

  const url = `${baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(Number(process.env.PAYMONGO_REQUEST_TIMEOUT_MS || 15000)),
  });

  const body: any = await response.json();
  if (!response.ok) {
    const errorDetails = Array.isArray(body?.errors) ? body.errors[0] : null;
    const message = errorDetails?.detail || body?.message || `PayMongo HTTP ${response.status}`;
    const code = errorDetails?.code || 'PAYMONGO_API_ERROR';
    throw new PayMongoError(message, response.status, code, body);
  }

  return body;
}
