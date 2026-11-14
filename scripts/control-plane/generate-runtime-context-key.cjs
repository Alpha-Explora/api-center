#!/usr/bin/env node
// Generates an Ed25519 key pair for the signed runtime context (control plane v2).
//   Gateway:  APICENTER_RUNTIME_CONTEXT_SIGNING_KEY  = the private JWK (store in Secret Manager)
//   Runtimes: APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS  = JSON array of public JWKs
// Rotation: add the new public JWK to every runtime's array first, then switch the gateway's
// signing key, then remove the old public JWK after the 60-second context lifetime has passed.
// Usage: node scripts/control-plane/generate-runtime-context-key.cjs [kid]

const { generateKeyPairSync } = require('node:crypto');

const kid = process.argv[2] || `ctx-${new Date().toISOString().slice(0, 10)}`;
if (!/^[A-Za-z0-9._-]{1,64}$/.test(kid)) {
  console.error('kid must be 1-64 characters of letters, digits, dot, underscore or hyphen');
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const signingKey = { ...privateKey.export({ format: 'jwk' }), kid };
const publicKeys = [{ ...publicKey.export({ format: 'jwk' }), kid }];

process.stdout.write(`APICENTER_RUNTIME_CONTEXT_SIGNING_KEY=${JSON.stringify(signingKey)}\n`);
process.stdout.write(`APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS=${JSON.stringify(publicKeys)}\n`);
