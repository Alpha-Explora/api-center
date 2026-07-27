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

module.exports = { createMemoryRateLimitStore };
