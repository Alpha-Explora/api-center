// APICenter-owned payment IDs (ADR-0010). Every public payment ID is minted here; the payment provider's
// ID is stored beside it in resource_owners.provider_resource_id and never derived from it.
import { mintId, mintedIdPattern } from '@apicenter/runtime';

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

/** `${prefix}_` + 26 lowercase Crockford base32 characters (130 random bits). */
export function mintPublicId(type: PaymentResourceType): string {
  return mintId(PUBLIC_ID_PREFIX[type]);
}

export const PUBLIC_ID_PATTERN = mintedIdPattern(Object.values(PUBLIC_ID_PREFIX));
