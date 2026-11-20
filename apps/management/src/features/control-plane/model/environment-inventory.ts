import { z } from "zod";

/** An active key of any application in the environment (GET …/environments/:env/credentials). */
export const environmentCredentialSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  lookupPrefix: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type EnvironmentCredential = z.infer<typeof environmentCredentialSchema>;

/** An active grant of any application in the environment (GET …/environments/:env/grants). */
export const environmentGrantSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  targetKind: z.string(),
  capability: z.string().optional(),
  apiId: z.string().optional(),
  action: z.string(),
  createdAt: z.string(),
});
export type EnvironmentGrant = z.infer<typeof environmentGrantSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Keys expiring within this many days are flagged. */
export const EXPIRY_WARNING_DAYS = 14;

export type ExpiryState = "expired" | "expiring" | "current";

/** How close an active key is to expiring. Revoked keys are not flagged. */
export function expiryState(credential: { status: string; expiresAt: string }, now = Date.now()): ExpiryState {
  const expiresAt = Date.parse(credential.expiresAt);
  if (credential.status !== "active" || Number.isNaN(expiresAt)) return "current";
  if (expiresAt <= now) return "expired";
  return expiresAt - now <= EXPIRY_WARNING_DAYS * DAY_MS ? "expiring" : "current";
}

/** Active keys that are expired or expire within the warning window, soonest first. */
export function keysNeedingReplacement<T extends { status: string; expiresAt: string }>(credentials: T[], now = Date.now()): T[] {
  return credentials.filter((credential) => expiryState(credential, now) !== "current").sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

/** An active key that still authenticates: not revoked and not past its expiry. */
export function isUsableKey(credential: { status: string; expiresAt: string }, now = Date.now()): boolean {
  return credential.status === "active" && Date.parse(credential.expiresAt) > now;
}
