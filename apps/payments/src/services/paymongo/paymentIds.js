const crypto = require('node:crypto');

function toPublicId(kind, providerId) {
  const value = String(providerId || '');
  if (!value) return value;
  if (value.startsWith(`${kind}_v1_`)) return value;
  return `${kind}_v1_${Buffer.from(value, 'utf8').toString('base64url')}`;
}

function toProviderId(kind, publicId) {
  const value = String(publicId || '');
  const prefix = `${kind}_v1_`;
  if (!value.startsWith(prefix)) return value;
  try { return Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'); }
  catch { return value; }
}

function generatedPublicId(kind) {
  return `${kind}_v1_${crypto.randomUUID().replace(/-/g, '')}`;
}

module.exports = { generatedPublicId, toProviderId, toPublicId };