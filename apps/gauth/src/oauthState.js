const crypto = require('node:crypto');

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getStateSecret(env = process.env) {
  const secret = env.GOOGLE_OAUTH_STATE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('GOOGLE_OAUTH_STATE_SECRET must be at least 32 characters.');
  }

  return secret;
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSignedOAuthState(payload, env = process.env) {
  const secret = getStateSecret(env);
  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    nonce: crypto.randomUUID().replace(/-/g, ''),
    issuedAt: Date.now(),
  }));
  const signature = signPayload(body, secret);
  return `${body}.${signature}`;
}

function verifySignedOAuthState(state, env = process.env) {
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

module.exports = {
  createSignedOAuthState,
  verifySignedOAuthState,
};
