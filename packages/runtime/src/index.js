const { createSharedServiceApp, createSuccessResponse, createFailureResponse, fail, ok } = require('./app');
const { createMemoryCacheStore } = require('./cacheStore');
const { createMemoryIdempotencyStore, createScopedIdempotencyKey } = require('./idempotencyStore');
const { recordProviderMetric } = require('./metrics');
const { ProviderGuardError, createCircuitBreaker, withProviderTimeout } = require('./providerGuard');
const { createMemoryRateLimitStore } = require('./rateLimitStore');
const { createSharedIdempotencyStore, createSharedRateLimitStore } = require('./sharedStores');
const { sendTwilioSms, sendResendEmail } = require('./delivery');
const { registerWithGateway, shouldRegisterWithGateway } = require('./registerWithGateway');

module.exports = {
  ProviderGuardError,
  createCircuitBreaker,
  createMemoryCacheStore,
  createMemoryIdempotencyStore,
  createScopedIdempotencyKey,
  createMemoryRateLimitStore,
  createSharedIdempotencyStore,
  createSharedRateLimitStore,
  sendTwilioSms,
  sendResendEmail,
  createSharedServiceApp,
  createSuccessResponse,
  createFailureResponse,
  fail,
  ok,
  recordProviderMetric,
  registerWithGateway,
  shouldRegisterWithGateway,
  withProviderTimeout,
};
