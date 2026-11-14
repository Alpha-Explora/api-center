/**
 * Normalize only the two pre-canonical shared payment scope names.
 * Resource-specific charge/refund scopes deliberately have no compatibility alias.
 */
const LEGACY_PAYMENT_SCOPE_ALIASES: Readonly<Record<string, string>> = {
  "payment:read": "payments:read",
  "payment:write": "payments:write",
};

export function normalizePaymentServiceScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => LEGACY_PAYMENT_SCOPE_ALIASES[scope] ?? scope))];
}
