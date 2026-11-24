const { createSharedServiceApp, createSuccessResponse, createFailureResponse, fail, ok } = require('./app');
const { createMemoryCacheStore } = require('./cacheStore');
const { createMemoryIdempotencyStore, createScopedIdempotencyKey } = require('./idempotencyStore');
const { recordProviderMetric } = require('./metrics');
const { ProviderGuardError, createCircuitBreaker, withProviderTimeout } = require('./providerGuard');
const { createMemoryRateLimitStore, recipientRateLimitKey } = require('./rateLimitStore');
const { createSharedIdempotencyStore, createSharedRateLimitStore } = require('./sharedStores');
const { formatSender } = require('./delivery');
const { MessagingProviderError, createSmsSender, createEmailSender } = require('./messaging');
const { mintId, mintedIdPattern } = require('./ids');
const {
  SharedServiceCallerError,
  readSharedServiceCaller,
  readRuntimeApplicationContext,
  callerIdempotencyScope,
  createRuntimeContextGate,
  sameProject,
  RUNTIME_CONTEXT_HEADER,
} = require('./sharedServiceCaller');
const { RuntimeContextError, loadRuntimeContextKeys, verifyRuntimeContext } = require('./runtimeContext');

module.exports = {
  mintId,
  mintedIdPattern,
  ProviderGuardError,
  SharedServiceCallerError,
  createCircuitBreaker,
  readSharedServiceCaller,
  readRuntimeApplicationContext,
  callerIdempotencyScope,
  createRuntimeContextGate,
  sameProject,
  RUNTIME_CONTEXT_HEADER,
  RuntimeContextError,
  loadRuntimeContextKeys,
  verifyRuntimeContext,
  createMemoryCacheStore,
  createMemoryIdempotencyStore,
  createScopedIdempotencyKey,
  createMemoryRateLimitStore,
  recipientRateLimitKey,
  createSharedIdempotencyStore,
  createSharedRateLimitStore,
  MessagingProviderError,
  createSmsSender,
  createEmailSender,
  formatSender,
  createSharedServiceApp,
  createSuccessResponse,
  createFailureResponse,
  fail,
  ok,
  recordProviderMetric,
  withProviderTimeout,
};
