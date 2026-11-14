import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/** The caller APICenter authorized for a request to your published API. */
export interface ApiCenterCallerContext {
  requestId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  environment: 'test' | 'live';
  applicationId: string;
  /** The catalogued action APICenter granted, e.g. `orders:read`. */
  action: string;
  /** Who owns records this call creates: the caller's organization and project. */
  owner: { groupId: string; projectId: string };
}

export interface ContextVerifierOptions {
  /** Your published API's ID (`api_…`). Tokens for any other audience are rejected. */
  apiId: string;
  /** APICenter's Ed25519 public JWKs, e.g. the value of APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS. */
  publicKeys: string | Array<{ kty: string; crv: string; x: string; kid: string }>;
  clockSkewSeconds?: number;
  now?: () => number;
}

export class ApiCenterContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiCenterContextError';
  }
}

const TYPE = 'apicenter-context+jwt';
const ISSUER = 'apicenter-gateway';
const MAX_LIFETIME_SECONDS = 300;

/**
 * Returns a function that verifies the `X-APICenter-Context` header APICenter sends with each
 * request to your published API. Any failure throws ApiCenterContextError; never fall back to
 * trusting other headers.
 */
export function createContextVerifier(options: ContextVerifierOptions): (headerValue: string | null | undefined) => ApiCenterCallerContext {
  if (!/^api_[a-z0-9]{24}$/.test(options.apiId)) throw new TypeError('apiId must be a published API ID (api_…)');
  const keys = loadKeys(options.publicKeys);
  const audience = `apicenter-api:${options.apiId}`;
  const skew = options.clockSkewSeconds ?? 5;
  const now = options.now ?? Date.now;

  return (headerValue) => {
    if (typeof headerValue !== 'string' || !headerValue) throw new ApiCenterContextError('X-APICenter-Context is missing');
    const parts = headerValue.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw new ApiCenterContextError('X-APICenter-Context is malformed');
    const header = decode(parts[0]);
    if (header.alg !== 'EdDSA' || header.typ !== TYPE) throw new ApiCenterContextError('Unsupported context algorithm or type');
    const key = typeof header.kid === 'string' ? keys.get(header.kid) : undefined;
    if (!key) throw new ApiCenterContextError('Context signing key is not trusted');
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), key, Buffer.from(parts[2], 'base64url'))) {
      throw new ApiCenterContextError('Context signature is invalid');
    }
    const claims = decode(parts[1]);
    if (claims.iss !== ISSUER) throw new ApiCenterContextError('Context issuer is not trusted');
    if (claims.aud !== audience) throw new ApiCenterContextError('Context was issued for a different API');
    const seconds = Math.floor(now() / 1000);
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) throw new ApiCenterContextError('Context timestamps are required');
    if ((claims.exp as number) <= seconds - skew) throw new ApiCenterContextError('Context has expired');
    if ((claims.iat as number) > seconds + skew) throw new ApiCenterContextError('Context is not yet valid');
    if ((claims.exp as number) - (claims.iat as number) > MAX_LIFETIME_SECONDS) throw new ApiCenterContextError('Context lifetime is too long');
    if (claims.env_kind !== 'test' && claims.env_kind !== 'live') throw new ApiCenterContextError('Context environment is invalid');
    const text = (name: string) => {
      const value = claims[name];
      if (typeof value !== 'string' || !value) throw new ApiCenterContextError(`Context claim ${name} is required`);
      return value;
    };
    return {
      requestId: text('jti'),
      organizationId: text('org'),
      projectId: text('prj'),
      environmentId: text('env'),
      environment: claims.env_kind,
      applicationId: text('app'),
      action: text('act'),
      owner: {
        groupId: typeof claims.own_grp === 'string' ? claims.own_grp : text('org'),
        projectId: typeof claims.own_prj === 'string' ? claims.own_prj : text('prj'),
      },
    };
  };
}

function loadKeys(input: ContextVerifierOptions['publicKeys']): Map<string, KeyObject> {
  const entries = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('publicKeys must be a non-empty array of Ed25519 JWKs');
  const keys = new Map<string, KeyObject>();
  for (const entry of entries as Array<Record<string, unknown>>) {
    if (entry.kty !== 'OKP' || entry.crv !== 'Ed25519' || typeof entry.x !== 'string' || typeof entry.kid !== 'string') {
      throw new TypeError('Each public key must be an Ed25519 JWK with a kid');
    }
    if ('d' in entry) throw new TypeError('publicKeys must not contain private key material');
    keys.set(entry.kid, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: entry.x }, format: 'jwk' }));
  }
  return keys;
}

function decode(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ApiCenterContextError('X-APICenter-Context is malformed');
  }
}
