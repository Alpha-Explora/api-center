export function normalizeAmount(rawAmount: any, currency = 'PHP') {
  const value = Number(rawAmount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be a positive number.');
  }
  return {
    value,
    currency: currency.toUpperCase(),
  };
}
