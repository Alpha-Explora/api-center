// Provider-neutral payment errors (ADR-0010). A provider's own error codes, messages and response bodies are
// logged, never returned: callers receive APICenter codes and neutral reasons. During the deprecation window
// the provider's code alone is also returned as `deprecatedProviderCode`.

export type NeutralPaymentErrorCode = 'PAYMENT_DECLINED' | 'PAYMENT_REQUEST_INVALID' | 'NOT_FOUND'
  | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_ERROR';

export type DeclineReason = 'insufficient_funds' | 'card_expired' | 'invalid_card_details' | 'card_declined'
  | 'authentication_failed' | 'cancelled_by_payer' | 'processor_unavailable' | 'other';

export type TransferFailureCode = 'insufficient_funds' | 'invalid_destination' | 'rate_limited'
  | 'wallet_not_configured' | 'rejected' | 'failed';

/** The date `deprecatedProviderCode` stops being returned (listed in contracts/public/provider-terms.json). */
export const PROVIDER_CODE_SUNSET = '2027-03-01';

const DECLINES: Record<string, DeclineReason> = {
  insufficient_funds: 'insufficient_funds',
  card_expired: 'card_expired',
  expired_card: 'card_expired',
  cvc_invalid: 'invalid_card_details',
  cvc_incorrect: 'invalid_card_details',
  card_number_invalid: 'invalid_card_details',
  invalid_card_number: 'invalid_card_details',
  generic_decline: 'card_declined',
  card_declined: 'card_declined',
  do_not_honor: 'card_declined',
  fraudulent: 'card_declined',
  lost_card: 'card_declined',
  stolen_card: 'card_declined',
  blocked: 'card_declined',
  processor_blocked: 'card_declined',
  card_not_supported: 'card_declined',
  authentication_failed: 'authentication_failed',
  three_d_secure_failed: 'authentication_failed',
  '3ds_failed': 'authentication_failed',
  processor_unavailable: 'processor_unavailable',
  processor_declined: 'card_declined',
  payment_cancelled: 'cancelled_by_payer',
  cancelled: 'cancelled_by_payer',
  user_cancelled: 'cancelled_by_payer',
};

const DECLINE_MESSAGES: Record<DeclineReason, string> = {
  insufficient_funds: 'The payment was declined for insufficient funds.',
  card_expired: 'The payment was declined because the card has expired.',
  invalid_card_details: 'The payment was declined because the card details are invalid.',
  card_declined: 'The payment was declined by the card issuer or wallet.',
  authentication_failed: 'The payer did not complete authentication.',
  cancelled_by_payer: 'The payer cancelled the payment.',
  processor_unavailable: 'The payment network was unavailable. Try again later.',
  other: 'The payment could not be completed.',
};

export function declineReason(providerCode: string | undefined): DeclineReason {
  return (providerCode && DECLINES[providerCode.toLowerCase()]) || 'other';
}

export function declineMessage(reason: DeclineReason): string {
  return DECLINE_MESSAGES[reason];
}

/** Translates a provider HTTP error into the error APICenter returns. */
export function toNeutralError(status: number, providerCode: string | undefined):
  { status: number; code: NeutralPaymentErrorCode; message: string; reason?: DeclineReason } {
  if (status === 400 || status === 402 || status === 422) {
    const reason = declineReason(providerCode);
    if (reason !== 'other' || status === 402) {
      return { status: 402, code: 'PAYMENT_DECLINED', message: declineMessage(reason), reason };
    }
    return { status: 400, code: 'PAYMENT_REQUEST_INVALID', message: 'The payment provider rejected the request.' };
  }
  if (status === 404) return { status: 404, code: 'NOT_FOUND', message: 'The payment resource was not found.' };
  if (status === 429) {
    return { status: 429, code: 'PROVIDER_RATE_LIMITED', message: 'The payment provider is rate limiting requests. Retry later.' };
  }
  if (status === 401 || status === 403) {
    return { status: 503, code: 'PROVIDER_UNAVAILABLE', message: 'Payments are temporarily unavailable.' };
  }
  return { status: 502, code: 'PROVIDER_ERROR', message: 'The payment provider could not complete the request.' };
}

/** Translates a provider's transfer failure into the payout failure code APICenter returns. */
export function toTransferFailure(providerCode: string | null | undefined): TransferFailureCode | null {
  if (!providerCode) return null;
  const code = providerCode.toLowerCase();
  if (['insufficient_funds', 'invalid_destination', 'rate_limited', 'wallet_not_configured', 'rejected', 'failed']
    .includes(code)) return code as TransferFailureCode;
  if (code.includes('insufficient') || code.includes('balance')) return 'insufficient_funds';
  if (/(account|destination|recipient|bic|bank|institution)/.test(code)) return 'invalid_destination';
  if (code.includes('rate')) return 'rate_limited';
  return 'rejected';
}
