import { PayMongoError } from './payment-errors';

const secretKey = process.env.PAYMONGO_SECRET_KEY || '';
const baseUrl = process.env.PAYMONGO_BASE_URL || 'https://api.paymongo.com/v1';

export function isMockMode(): boolean {
  return !secretKey || process.env.PAYMENT_PROVIDER_MODE === 'mock';
}

export function providerMode(): string {
  return isMockMode() ? 'mock' : 'live';
}

export function getAuthHeader(): string {
  const encoded = Buffer.from(`${secretKey}:`).toString('base64');
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
