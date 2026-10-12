#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const readText = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const fail = (message) => failures.push(message);

const openApi = readJson('packages/contracts/apicenter-openapi.json');
const asyncApi = readJson('packages/contracts/apicenter-asyncapi.json');
const sharedContract = readJson('packages/contracts/shared-service-contract.json');
const contractsSource = readText('packages/contracts/src/index.ts');
const paymentSource = readText('packages/sdk/src/services/payments.ts');
const publicTypeSource = readText('packages/sdk/src/types.ts');
const eventSource = readText('packages/sdk/src/payment/events.ts');

const requiredSharedOperations = [
  'email.send', 'email.getStatus',
  'sms.send', 'sms.getStatus',
  'otp.generate', 'otp.verify', 'otp.getStatus',
  'geo.geocodeAddress', 'geo.reverseGeocode', 'geo.checkFence',
  'googleAuth.getAuthorizationUrl', 'googleAuth.exchangeCode',
  'googleAuth.refreshToken', 'googleAuth.logout',
];
const sharedOperationFiles = {
  email: 'packages/sdk/src/services/email.ts',
  sms: 'packages/sdk/src/services/sms.ts',
  otp: 'packages/sdk/src/services/otp.ts',
  geo: 'packages/sdk/src/services/geo.ts',
  gauth: 'packages/sdk/src/services/google-auth.ts',
};
const sharedOperations = new Map(
  (sharedContract.sdkOperations ?? []).map((operation) => [operation.operationId, operation]),
);

for (const operationId of requiredSharedOperations) {
  const operation = sharedOperations.get(operationId);
  if (!operation) {
    fail(`Shared-service contract is missing SDK operation ${operationId}`);
    continue;
  }

  const sourcePath = sharedOperationFiles[operation.serviceId];
  if (!sourcePath) {
    fail(`${operationId} refers to unsupported shared service ${operation.serviceId}`);
    continue;
  }
  const source = readText(sourcePath);
  const anchor = `@sdk-operation ${operationId} ${operation.method} ${operation.path}`;
  if (!source.includes(anchor)) fail(`${operationId} must map to ${operation.method} ${operation.path}`);
  if (!Array.isArray(operation.requiredScopes) || operation.requiredScopes.length === 0) {
    fail(`${operationId} must declare its gateway-owned required scopes`);
  }

  for (const typeName of [operation.requestType, operation.responseType].filter(Boolean)) {
    if (!new RegExp(`\\b(?:interface|type) ${typeName}\\b`).test(contractsSource)) {
      fail(`${operationId} refers to non-contract type ${typeName}`);
    }
  }

  if (operation.idempotencyKey?.required) {
    const accepted = operation.idempotencyKey;
    if (accepted.minLength !== 16 || accepted.maxLength !== 255) {
      fail(`${operationId} idempotency limits must match the gateway (16-255)`);
    }
    if (!source.includes('idempotencyKey: options.idempotencyKey')) {
      fail(`${operationId} must pass its typed idempotency key through the transport`);
    }
  }
}

const requiredPaymentOperationIds = [
  'createCheckout', 'getCheckout', 'getCheckoutByReference', 'cancelCheckout',
  'createPaymentIntent', 'createQrPhPaymentIntent', 'getPaymentIntent', 'confirmPaymentIntent', 'cancelPaymentIntent',
  'createCustomer', 'getCustomer', 'createPlan', 'getPlan', 'listPlans',
  'createPaymentLink', 'listPaymentLinks', 'getPaymentLink', 'setPaymentLinkArchived',
  'createRefund', 'getRefund', 'createSubscription', 'getSubscription', 'cancelSubscription',
  'listSubscriptionInvoices', 'getInvoice', 'getPaymentCapabilities', 'listPaymentRecords',
];
const paymentOperations = new Map();
for (const [route, methods] of Object.entries(openApi.paths ?? {})) {
  for (const [method, definition] of Object.entries(methods)) {
    if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;
    if (definition.operationId) paymentOperations.set(definition.operationId, { route, method: method.toUpperCase() });
  }
}

for (const operationId of requiredPaymentOperationIds) {
  const operation = paymentOperations.get(operationId);
  if (!operation) {
    fail(`OpenAPI is missing the supported payment operation ${operationId}`);
    continue;
  }
  const anchor = `@sdk-operation ${operationId} ${operation.method} ${operation.route}`;
  if (!paymentSource.includes(anchor)) fail(`SDK is missing payment mapping ${anchor}`);
}

if (publicTypeSource.match(/\bprovider\b/i)) fail('Public SDK types must not declare provider-specific fields directly');

const eventSchema = asyncApi.components?.schemas?.PaymentEvent;
const requiredEventFields = [
  'eventId', 'contractVersion', 'eventType', 'ownerTribeId', 'consumerServiceId',
  'referenceId', 'aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', 'data',
];
for (const field of requiredEventFields) {
  if (!eventSchema?.required?.includes(field)) fail(`AsyncAPI PaymentEvent must require ${field}`);
  if (!eventSource.includes(field)) fail(`SDK event parser must validate ${field}`);
}
if (!eventSource.includes('data.aggregateVersion') || !eventSource.includes('aggregateVersion')) {
  fail('SDK event parser must validate aggregate version parity');
}

const entryPoint = readText('packages/sdk/src/index.ts');
for (const exportName of ['ApiCenter', 'ApiCenterError', 'parsePaymentEvent', 'PaymentEventSchema']) {
  if (!entryPoint.includes(exportName)) fail(`SDK entry point must export ${exportName}`);
}

for (const obsoleteFile of [
  'packages/sdk/src/TribeClient.ts',
  'packages/sdk/src/internal/payment.ts',
  'packages/sdk/src/internal/shared-services.ts',
]) {
  if (fs.existsSync(path.join(root, obsoleteFile))) fail(`Obsolete SDK implementation remains: ${obsoleteFile}`);
}

if (failures.length > 0) {
  console.error('SDK contract check failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('SDK operations, types, and payment events match the pinned public contracts.');
