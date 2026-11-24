import { z } from 'zod';

const childSecrets = z.record(z.string().regex(/^org_[A-Za-z0-9]+$/), z.string().min(1));

export function createChildWebhookSecretLookup(raw = process.env.PAYMONGO_CHILD_WEBHOOK_SECRETS) {
  try {
    const secrets = raw ? childSecrets.parse(JSON.parse(raw)) : {};
    const entries = new Map(Object.entries(secrets));
    return (accountId: string) => entries.get(accountId);
  } catch {
    throw new Error('PAYMONGO_CHILD_WEBHOOK_SECRETS must map child IDs to webhook secrets');
  }
}
