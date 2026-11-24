import { createHash } from 'node:crypto';
import { PayMongoError } from './payment-errors';
import { toNeutralError } from './provider-errors';

const baseUrl = (process.env.PAYMONGO_BASE_URL || 'https://api.paymongo.com/v1').replace(/\/+$/, '');

export type PayMongoAccount = { id: string; kind: 'parent' | 'child' };

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

export function hasPayMongoTestCredentials(): boolean {
  return process.env.PAYMENT_PROVIDER_MODE === 'test' && secretKey().startsWith('sk_test_');
}

/** One request of a multi-step provider flow, keyed so a retry of the whole flow repeats each step exactly once. */
export function stepIdempotencyKey(key: string | undefined, step: string): string | undefined {
  return key ? createHash('sha256').update(`${key}:${step}`).digest('hex') : undefined;
}

export function getAuthHeader(): string {
  const encoded = Buffer.from(`${secretKey()}:`).toString('base64');
  return `Basic ${encoded}`;
}

export async function paymongoRequest(endpoint: string, options: {
  method?: string;
  body?: any;
  idempotencyKey?: string;
  /** The merchant account to act as. A child account is addressed with PayMongo's Account-ID header. */
  account?: PayMongoAccount;
} = {}): Promise<any> {
  if (isMockMode()) {
    return { data: { id: `mock_${Date.now()}`, attributes: { status: 'succeeded' } } };
  }

  const url = `${/^\/v\d+\//.test(endpoint) ? baseUrl.replace(/\/v\d+$/, '') : baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  if (options.account?.kind === 'child') {
    headers['Account-ID'] = options.account.id;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(Number(process.env.PAYMONGO_REQUEST_TIMEOUT_MS || 15000)),
    });
  } catch (error) {
    // No response: the request may or may not have reached PayMongo. Callers that move money must treat
    // this as an unknown outcome, never as a rejection.
    const unreachable = new PayMongoError('The payment provider could not be reached.', 0, 'PROVIDER_UNREACHABLE');
    unreachable.provider = { status: 0, message: (error as Error).message };
    throw unreachable;
  }

  const body: any = await response.json();
  if (!response.ok) {
    const errorDetails = Array.isArray(body?.errors) ? body.errors[0] : null;
    const providerCode: string | undefined = typeof errorDetails?.code === 'string' ? errorDetails.code : undefined;
    const neutral = toNeutralError(response.status, providerCode);
    const error = new PayMongoError(neutral.message, neutral.status, neutral.code, {
      ...(neutral.reason ? { reason: neutral.reason } : {}),
      ...(providerCode ? { deprecatedProviderCode: providerCode } : {}),
    });
    error.providerStatus = response.status;
    error.provider = { status: response.status, code: providerCode,
      message: errorDetails?.detail || body?.message, body };
    throw error;
  }

  return body;
}
