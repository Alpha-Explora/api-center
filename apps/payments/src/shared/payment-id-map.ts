// APICenter-owned payment IDs (ADR-0010). Every public payment ID is minted here; the payment provider's
// ID is stored beside it in resource_owners.provider_resource_id and never derived from it.
import { randomBytes } from 'node:crypto';

export const PUBLIC_ID_PREFIX = {
  checkout: 'chk',
  intent: 'pi',
  payment: 'pay',
  refund: 'ref',
  customer: 'cus',
  plan: 'plan',
  payment_link: 'pl',
  subscription: 'sub',
  invoice: 'inv',
} as const;

export type PaymentResourceType = keyof typeof PUBLIC_ID_PREFIX;

/** The payment provider behind provider_resource_id. One provider today; the column allows another. */
export const PAYMENT_PROVIDER = 'paymongo';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

/** `${prefix}_` + 26 lowercase Crockford base32 characters (130 random bits). */
export function mintPublicId(type: PaymentResourceType): string {
  const bytes = randomBytes(26);
  let body = '';
  for (const byte of bytes) body += CROCKFORD[byte % 32];
  return `${PUBLIC_ID_PREFIX[type]}_${body}`;
}

export const PUBLIC_ID_PATTERN = /^(chk|pi|pay|ref|cus|plan|pl|sub|inv)_[0-9a-hjkmnp-tv-z]{26}$/;
