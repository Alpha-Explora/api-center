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
const paymentSource = readText('packages/sdk/src/internal/payment.ts');
const publicTypeSource = readText('packages/sdk/src/types.ts');
const eventSource = readText('packages/sdk/src/payment/events.ts');

const requiredOperations = {
  'POST /api/v1/payments/checkouts': 'createCheckout',
  'GET /api/v1/payments/checkouts/{checkoutId}': 'getCheckout',
  'GET /api/v1/payments/checkouts/by-reference/{referenceId}': 'getCheckoutByReference',
  'POST /api/v1/payments/checkouts/{checkoutId}/cancel': 'cancelCheckout',
  'POST /api/v1/payments/intents': 'createPaymentIntent',
  'GET /api/v1/payments/intents/{paymentIntentId}': 'getPaymentIntent',
  'POST /api/v1/payments/intents/{paymentIntentId}/confirm': 'confirmPaymentIntent',
  'POST /api/v1/payments/intents/{paymentIntentId}/cancel': 'cancelPaymentIntent',
  'POST /api/v1/payments/customers': 'createCustomer',
  'GET /api/v1/payments/customers/{customerId}': 'getCustomer',
  'POST /api/v1/payments/plans': 'createPlan',
  'GET /api/v1/payments/plans/{planId}': 'getPlan',
  'GET /api/v1/payments/plans': 'listPlans',
  'POST /api/v1/payments/refunds': 'createRefund',
  'GET /api/v1/payments/refunds/{refundId}': 'getRefund',
  'POST /api/v1/payments/subscriptions': 'createSubscription',
  'GET /api/v1/payments/subscriptions/{subscriptionId}': 'getSubscription',
  'POST /api/v1/payments/subscriptions/{subscriptionId}/cancel': 'cancelSubscription',
  'GET /api/v1/payments/subscriptions/{subscriptionId}/invoices': 'listSubscriptionInvoices',
  'GET /api/v1/payments/invoices/{invoiceId}': 'getInvoice',
  'GET /api/v1/payments/capabilities': 'getPaymentCapabilities',
  'GET /api/v1/payments/records': 'listPaymentRecords',
};

for (const [operation, operationId] of Object.entries(requiredOperations)) {
  const [method, route] = operation.split(' ');
  const definition = openApi.paths?.[route]?.[method.toLowerCase()];
  if (!definition) fail(`Missing OpenAPI operation ${operation}`);
  else if (definition.operationId !== operationId) fail(`${operation} must use operationId ${operationId}`);
  if (!new RegExp(`\\b${operationId}\\s*\\(`).test(paymentSource)) fail(`SDK is missing method ${operationId}`);
}

if (publicTypeSource.match(/\bprovider\b/i)) fail('Public SDK types must not expose provider-specific fields');

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

if (failures.length > 0) {
  console.error('SDK contract check failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('SDK and pinned public contracts are compatible.');
