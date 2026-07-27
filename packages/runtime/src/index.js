const { createSharedServiceApp, fail, ok } = require('./app');
const { createMemoryCacheStore } = require('./cacheStore');
const { createMemoryIdempotencyStore } = require('./idempotencyStore');
const { recordProviderMetric } = require('./metrics');
const { ProviderGuardError, createCircuitBreaker, withProviderTimeout } = require('./providerGuard');
const { createMemoryRateLimitStore } = require('./rateLimitStore');
const { registerWithGateway, shouldRegisterWithGateway } = require('./registerWithGateway');

module.exports = {
  ProviderGuardError,
  createCircuitBreaker,
  createMemoryCacheStore,
  createMemoryIdempotencyStore,
  createMemoryRateLimitStore,
  createSharedServiceApp,
  fail,
  ok,
  recordProviderMetric,
  registerWithGateway,
  shouldRegisterWithGateway,
  withProviderTimeout,
};
