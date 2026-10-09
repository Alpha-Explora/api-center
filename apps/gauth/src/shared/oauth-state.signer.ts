import crypto from 'node:crypto';

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

let developmentStateSecret: string | undefined;

/**
 * Returns the key that signs OAuth state. Production must set GOOGLE_OAUTH_STATE_SECRET, and gauth refuses
 * to start without it. Other environments get a random key per process, so state issued by one local process
 * cannot be verified by another.
 */
export function getStateSecret(env: Record<string, string | undefined> = process.env): string {
  if (env.GOOGLE_OAUTH_STATE_SECRET) {
    return env.GOOGLE_OAUTH_STATE_SECRET;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('GOOGLE_OAUTH_STATE_SECRET is required in production.');
  }
  developmentStateSecret ??= crypto.randomBytes(32).toString('base64url');
  return developmentStateSecret;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSignedOAuthState(payload: Record<string, any>, env: Record<string, string | undefined> = process.env): string {
  const secret = getStateSecret(env);
  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    nonce: crypto.randomUUID().replace(/-/g, ''),
    issuedAt: Date.now(),
  }));
  const signature = signPayload(body, secret);
  return `${body}.${signature}`;
}

export function verifySignedOAuthState(state?: string, env: Record<string, string | undefined> = process.env): any | null {
  if (typeof state !== 'string' || !state.includes('.')) {
    return null;
  }

  const [body, signature] = state.split('.');
  if (!body || !signature) {
    return null;
  }

  const secret = getStateSecret(env);
  const expected = signPayload(body, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }
}
