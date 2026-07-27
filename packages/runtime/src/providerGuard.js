class ProviderGuardError extends Error {
  constructor(message, { code, provider, operation, statusCode = 502, details } = {}) {
    super(message);
    this.name = 'ProviderGuardError';
    this.code = code;
    this.provider = provider;
    this.operation = operation;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function withProviderTimeout(promise, {
  timeoutMs,
  provider = 'unknown',
  operation = 'request',
} = {}) {
  const resolvedTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
    return promise;
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProviderGuardError(
        `${provider} ${operation} timed out after ${resolvedTimeout}ms`,
        {
          code: 'PROVIDER_TIMEOUT',
          provider,
          operation,
          statusCode: 502,
          details: { timeoutMs: resolvedTimeout },
        },
      ));
    }, resolvedTimeout);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createCircuitBreaker({
  provider = 'unknown',
  failureThreshold = 5,
  resetAfterMs = 30_000,
  now = () => Date.now(),
} = {}) {
  let failures = 0;
  let openedAt;

  function isOpen() {
    if (openedAt === undefined) {
      return false;
    }

    if (now() - openedAt >= resetAfterMs) {
      failures = 0;
      openedAt = undefined;
      return false;
    }

    return true;
  }

  return {
    async exec(fn) {
      if (isOpen()) {
        throw new ProviderGuardError(
          `${provider} provider circuit is open`,
          {
            code: 'PROVIDER_CIRCUIT_OPEN',
            provider,
            operation: 'request',
            statusCode: 503,
          },
        );
      }

      try {
        const value = await fn();
        failures = 0;
        openedAt = undefined;
        return value;
      } catch (error) {
        failures += 1;
        if (failures >= failureThreshold) {
          openedAt = now();
        }
        throw error;
      }
    },
    state() {
      return {
        provider,
        failures,
        open: isOpen(),
        openedAt,
      };
    },
  };
}

module.exports = {
  ProviderGuardError,
  createCircuitBreaker,
  withProviderTimeout,
};
