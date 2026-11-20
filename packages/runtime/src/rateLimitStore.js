function createMemoryRateLimitStore({ now = () => Date.now() } = {}) {
  const buckets = new Map();

  async function consume(key, { limit, windowMs }) {
    const resolvedLimit = Math.max(1, Number(limit) || 1);
    const resolvedWindow = Math.max(1000, Number(windowMs) || 60_000);
    const currentTime = now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= currentTime) {
      bucket = {
        count: 0,
        resetAt: currentTime + resolvedWindow,
      };
    }

    if (bucket.count >= resolvedLimit) {
      buckets.set(key, bucket);
      return {
        allowed: false,
        remaining: 0,
        resetAt: bucket.resetAt,
      };
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    return {
      allowed: true,
      remaining: Math.max(0, resolvedLimit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  return { consume };
}

/**
 * The rate-limit key for one recipient of one project environment. The recipient is normalised so
 * " +63 917-123-4567" and "+639171234567" share a limit, and the key is scoped to the caller's
 * project and environment so one tenant cannot use up another tenant's limit for a number.
 */
function recipientRateLimitKey(namespace, caller, recipient) {
  const raw = String(recipient ?? '').trim().toLowerCase();
  const normalised = /^[+\d\s().-]+$/.test(raw) ? raw.replace(/[\s().-]/g, '') : raw;
  return [namespace, caller.projectId, caller.environment, normalised].join(':');
}

module.exports = { createMemoryRateLimitStore, recipientRateLimitKey };
