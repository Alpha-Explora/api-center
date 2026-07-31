import crypto from 'node:crypto';

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getStateSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.GOOGLE_OAUTH_STATE_SECRET || 'default_oauth_state_secret_32chars_long_minimum_key';
  return secret;
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
