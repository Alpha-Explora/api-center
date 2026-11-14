// Verifies the short-lived caller context the gateway signs for control-plane applications.
// Format: compact JWS, alg EdDSA (Ed25519), typ "apicenter-context+jwt". Keys are public JWKs
// supplied as a JSON array in APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS, selected by kid.

const { createPublicKey, verify } = require('node:crypto');

const CONTEXT_TYPE = 'apicenter-context+jwt';
const ISSUER = 'apicenter-gateway';
const ENVIRONMENTS = new Set(['test', 'live']);

class RuntimeContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimeContextError';
  }
}

function decodeSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new RuntimeContextError(`Runtime context ${label} is not valid JSON`);
  }
}

/** Parses the public key set. Throws on malformed configuration rather than accepting nothing silently. */
function loadRuntimeContextKeys(raw = process.env.APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS) {
  const keys = new Map();
  if (!raw || !raw.trim()) return keys;
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new RuntimeContextError('APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS must be a JSON array of Ed25519 JWKs');
  }
  if (!Array.isArray(entries)) {
    throw new RuntimeContextError('APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS must be a JSON array of Ed25519 JWKs');
  }
  for (const entry of entries) {
    if (!entry || entry.kty !== 'OKP' || entry.crv !== 'Ed25519' || typeof entry.x !== 'string' || typeof entry.kid !== 'string' || !entry.kid) {
      throw new RuntimeContextError('Each runtime context key must be an Ed25519 public JWK with a kid');
    }
    if (entry.d !== undefined) {
      throw new RuntimeContextError('Runtime context key set must not contain private key material');
    }
    keys.set(entry.kid, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: entry.x }, format: 'jwk' }));
  }
  return keys;
}

function requireString(claims, name) {
  const value = claims[name];
  if (typeof value !== 'string' || !value) throw new RuntimeContextError(`Runtime context claim ${name} is required`);
  return value;
}

/**
 * Verifies a runtime context token and returns its claims. Every failure throws; there is no
 * partially trusted result.
 */
function verifyRuntimeContext(token, { audience, keys, now = Date.now(), maxLifetimeSeconds = 300, clockSkewSeconds = 5 }) {
  if (!audience) throw new RuntimeContextError('Runtime context audience is not configured');
  if (!keys || keys.size === 0) throw new RuntimeContextError('Runtime context verification keys are not configured');
  if (typeof token !== 'string') throw new RuntimeContextError('Runtime context is missing');

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new RuntimeContextError('Runtime context is malformed');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = decodeSegment(encodedHeader, 'header');
  if (header.alg !== 'EdDSA' || header.typ !== CONTEXT_TYPE) {
    throw new RuntimeContextError('Runtime context uses an unsupported algorithm or type');
  }
  const key = typeof header.kid === 'string' ? keys.get(header.kid) : undefined;
  if (!key) throw new RuntimeContextError('Runtime context key is not trusted');

  const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
  const signature = Buffer.from(encodedSignature, 'base64url');
  if (!verify(null, signed, key, signature)) throw new RuntimeContextError('Runtime context signature is invalid');

  const claims = decodeSegment(encodedPayload, 'payload');
  if (claims.iss !== ISSUER) throw new RuntimeContextError('Runtime context issuer is not trusted');
  if (claims.aud !== audience) throw new RuntimeContextError('Runtime context audience does not match this runtime');

  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) {
    throw new RuntimeContextError('Runtime context timestamps are required');
  }
  if (claims.exp <= nowSeconds - clockSkewSeconds) throw new RuntimeContextError('Runtime context has expired');
  if (claims.iat > nowSeconds + clockSkewSeconds) throw new RuntimeContextError('Runtime context is not yet valid');
  if (claims.exp - claims.iat > maxLifetimeSeconds) throw new RuntimeContextError('Runtime context lifetime is too long');

  const environmentKind = requireString(claims, 'env_kind');
  if (!ENVIRONMENTS.has(environmentKind)) throw new RuntimeContextError('Runtime context environment must be test or live');

  return {
    requestId: requireString(claims, 'jti'),
    organizationId: requireString(claims, 'org'),
    projectId: requireString(claims, 'prj'),
    environmentId: requireString(claims, 'env'),
    environmentKind,
    applicationId: requireString(claims, 'app'),
    action: requireString(claims, 'act'),
    ownerGroupId: typeof claims.own_grp === 'string' && claims.own_grp ? claims.own_grp : requireString(claims, 'org'),
    ownerProjectId: typeof claims.own_prj === 'string' && claims.own_prj ? claims.own_prj : requireString(claims, 'prj'),
  };
}

module.exports = { RuntimeContextError, loadRuntimeContextKeys, verifyRuntimeContext, RUNTIME_CONTEXT_TYPE: CONTEXT_TYPE, RUNTIME_CONTEXT_ISSUER: ISSUER };
