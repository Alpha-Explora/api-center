import { ApiError } from "./client-core";

/** Attempts after the first, for a failure that may clear by itself. */
export const MAX_RETRIES = 3;
const MAX_DELAY_MS = 8_000;

/**
 * Whether a failure may clear by itself: the network, a timeout, rate limiting or the gateway being
 * busy or restarting. A 4xx other than 408 and 429 is an answer, and asking again changes nothing.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && isTransientError(error);
}

/** Honours Retry-After, otherwise doubles from one second with jitter so a page's queries spread out. */
export function retryDelay(attempt: number, error: unknown, random: () => number = Math.random): number {
  if (error instanceof ApiError && error.retryAfterSeconds !== undefined) {
    return Math.min(error.retryAfterSeconds * 1000, MAX_DELAY_MS);
  }
  const base = Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(base / 2 + random() * (base / 2));
}
