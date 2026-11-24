// APICenter-minted public IDs (ADR-0010): `${prefix}_` + 26 lowercase Crockford base32 characters
// (130 random bits). Provider IDs are stored beside them as data and never derived from them.
const { randomBytes } = require('node:crypto');

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const MINTED_BODY = '[0-9a-hjkmnp-tv-z]{26}';

function mintId(prefix) {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`Invalid ID prefix: ${prefix}`);
  let body = '';
  for (const byte of randomBytes(26)) body += CROCKFORD[byte % 32];
  return `${prefix}_${body}`;
}

/** A pattern matching IDs minted with one of `prefixes`. */
function mintedIdPattern(prefixes) {
  return new RegExp(`^(${prefixes.join('|')})_${MINTED_BODY}$`);
}

module.exports = { mintId, mintedIdPattern };
