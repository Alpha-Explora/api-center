import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

type RecordValue = Record<string, any>;

const root = join(__dirname, '../..');
const readYaml = (relativePath: string): RecordValue => parse(readFileSync(join(root, relativePath), 'utf8')) as RecordValue;
const readJson = (relativePath: string): RecordValue => JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as RecordValue;
const fail = (message: string): never => { throw new Error(`Public contract validation failed: ${message}`); };
function assert(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }

const openApi = readYaml('contracts/public/apicenter.openapi.yaml');
const asyncApi = readYaml('contracts/public/apicenter.asyncapi.yaml');
assert(openApi.openapi === '3.2.0', 'OpenAPI must use version 3.2.0');
assert(asyncApi.asyncapi === '3.1.0', 'AsyncAPI must use version 3.1.0');
assert(openApi.security?.length === 1 && openApi.security[0].ApplicationKey, 'OpenAPI must authenticate with the application key only');
assert(openApi.components?.securitySchemes?.ApplicationKey?.scheme === 'bearer'
  && Object.keys(openApi.components.securitySchemes).length === 1,
'OpenAPI must define exactly one bearer scheme, ApplicationKey');
const idempotencyParameter = openApi.components?.parameters?.IdempotencyKey;
assert(idempotencyParameter?.name === 'Idempotency-Key' && idempotencyParameter?.in === 'header'
  && idempotencyParameter?.required === true, 'Idempotency-Key header parameter is missing or invalid');

const requiredOperations: Record<string, string> = {
  'POST /api/v1/payments/checkouts': 'createCheckout',
  'GET /api/v1/payments/checkouts/{checkoutId}': 'getCheckout',
  'GET /api/v1/payments/checkouts/by-reference/{referenceId}': 'getCheckoutByReference',
  'POST /api/v1/payments/checkouts/{checkoutId}/cancel': 'cancelCheckout',
  'POST /api/v1/payments/intents': 'createPaymentIntent',
  'POST /api/v1/payments/intents/qrph': 'createQrPhPaymentIntent',
  'GET /api/v1/payments/intents/{paymentIntentId}': 'getPaymentIntent',
  'POST /api/v1/payments/intents/{paymentIntentId}/confirm': 'confirmPaymentIntent',
  'POST /api/v1/payments/intents/{paymentIntentId}/cancel': 'cancelPaymentIntent',
  'POST /api/v1/payments/customers': 'createCustomer',
  'GET /api/v1/payments/customers/{customerId}': 'getCustomer',
  'GET /api/v1/payments/plans': 'listPlans',
  'POST /api/v1/payments/plans': 'createPlan',
  'GET /api/v1/payments/plans/{planId}': 'getPlan',
  'GET /api/v1/payments/payment-links': 'listPaymentLinks',
  'POST /api/v1/payments/payment-links': 'createPaymentLink',
  'GET /api/v1/payments/payment-links/{paymentLinkId}': 'getPaymentLink',
  'PATCH /api/v1/payments/payment-links/{paymentLinkId}': 'setPaymentLinkArchived',
  'POST /api/v1/payments/refunds': 'createRefund',
  'GET /api/v1/payments/refunds/{refundId}': 'getRefund',
  'POST /api/v1/payments/subscriptions': 'createSubscription',
  'GET /api/v1/payments/subscriptions/{subscriptionId}': 'getSubscription',
  'POST /api/v1/payments/subscriptions/{subscriptionId}/cancel': 'cancelSubscription',
  'GET /api/v1/payments/subscriptions/{subscriptionId}/invoices': 'listSubscriptionInvoices',
  'GET /api/v1/payments/invoices/{invoiceId}': 'getInvoice',
  'GET /api/v1/payments/capabilities': 'getPaymentCapabilities',
  'POST /api/v1/payments/payees': 'createPayee',
  'GET /api/v1/payments/payees': 'listPayees',
  'GET /api/v1/payments/payees/{payeeId}': 'getPayee',
  'PUT /api/v1/payments/payees/{payeeId}/destination': 'setPayeeDestination',
  'PUT /api/v1/payments/payees/{payeeId}/verification': 'recordPayeeVerification',
  'POST /api/v1/payments/payees/{payeeId}/cash-out': 'cashOutPayee',
  'POST /api/v1/payments/allocations/{allocationId}/release': 'releaseAllocation',
  'POST /api/v1/payments/allocations/{allocationId}/cancel': 'cancelAllocation',
  'GET /api/v1/payments/payouts': 'listPayouts',
  'GET /api/v1/payments/payouts/{payoutId}': 'getPayout',
};
for (const [operation, operationId] of Object.entries(requiredOperations)) {
  const [method, route] = operation.split(' ', 2);
  const pathItem = openApi.paths?.[route];
  assert(pathItem, `${operation} route is missing`);
  const operationDefinition = pathItem[method.toLowerCase()];
  assert(operationDefinition, `${operation} operation is missing`);
  assert(operationDefinition.operationId === operationId, `${operation} must use operationId ${operationId}`);
}
for (const [route, pathItem] of Object.entries<RecordValue>(openApi.paths ?? {})) {
  assert(route.startsWith('/api/v1/payments/') || route.startsWith('/api/v1/shared/') || route === '/api/v1/whoami', `${route} is outside the public consumer namespace`);
  for (const [method, operation] of Object.entries<RecordValue>(pathItem)) {
    if (!['post', 'put', 'patch', 'delete'].includes(method) || !route.startsWith('/api/v1/payments/')) continue;
    assert((operation.parameters ?? []).some((parameter: RecordValue) => parameter.$ref === '#/components/parameters/IdempotencyKey'), `${method.toUpperCase()} ${route} must declare Idempotency-Key`);
    assert(operation.responses?.['409']?.$ref === '#/components/responses/IdempotencyConflict', `${method.toUpperCase()} ${route} must document idempotency conflicts`);
  }
}
const serializedOpenApi = JSON.stringify(openApi).toLowerCase();
assert(!serializedOpenApi.includes('paymongo_') && !serializedOpenApi.includes('paymongoid'), 'public HTTP contract leaks provider-specific fields');
assert(openApi.components?.schemas?.CheckoutCreateRequest?.properties?.metadata?.additionalProperties?.type === 'string', 'Checkout metadata must be string-valued correlation metadata');

const channel = asyncApi.channels?.['apicenter.payment-events.{environment}'];
assert(channel, 'payment event channel is missing');
assert(channel['x-apicenter-consumer-filter']?.attribute === 'consumerServiceId', 'event channel must filter by consumerServiceId');
assert(channel['x-apicenter-webhook-delivery']?.signature === 'standard-webhooks-v1', 'event delivery must be signed Standard Webhooks');
assert(channel['x-apicenter-webhook-delivery']?.maxDeliveryAttempts === 20, 'event delivery must define a 20-attempt dead-letter policy');
const paymentEvent = asyncApi.components?.schemas?.PaymentEvent;
const requiredEnvelopeFields = ['eventId', 'contractVersion', 'eventType', 'environment', 'organizationId', 'projectId', 'applicationId', 'referenceId', 'aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', 'data'];
for (const field of requiredEnvelopeFields) assert(paymentEvent?.required?.includes(field), `PaymentEvent must require ${field}`);
const checkoutPaid = asyncApi.components?.schemas?.CheckoutPaid;
for (const field of ['status', 'checkoutId', 'paymentId', 'amount', 'currency']) assert(checkoutPaid?.required?.includes(field), `CheckoutPaid must require ${field}`);
for (const name of ['IntentPaid', 'IntentFailed']) {
  const schema = asyncApi.components?.schemas?.[name];
  for (const field of ['status', 'paymentIntentId', 'paymentId', 'amount', 'currency']) assert(schema?.required?.includes(field), `${name} must require ${field}`);
}

const allocationHeld = asyncApi.components?.schemas?.AllocationHeld;
for (const field of ['status', 'allocationId', 'payeeId', 'paymentId', 'amount', 'currency']) assert(allocationHeld?.required?.includes(field), `AllocationHeld must require ${field}`);
for (const name of ['PayoutPaid', 'PayoutFailed']) {
  const schema = asyncApi.components?.schemas?.[name];
  for (const field of ['status', 'payoutId', 'payeeId', 'net', 'fee', 'currency', 'trigger']) assert(schema?.required?.includes(field), `${name} must require ${field}`);
}

const examplePaths = [
  'contracts/public/examples/payment-checkout-paid-event.json',
  'contracts/public/examples/payment-intent-paid-event.json',
  'contracts/public/examples/payment-intent-failed-event.json',
  'contracts/public/examples/payment-allocation-held-event.json',
  'contracts/public/examples/payment-payout-paid-event.json',
  'contracts/public/examples/payment-payout-failed-event.json',
];
for (const relativePath of examplePaths) {
  const example = readJson(relativePath);
  for (const field of requiredEnvelopeFields) assert(example[field] !== undefined, `${relativePath} is missing ${field}`);
  assert(example.contractVersion === '2.0', `${relativePath} must use contractVersion 2.0`);
  assert(['test', 'live'].includes(example.environment), `${relativePath} has an invalid environment`);
}
const paidExample = readJson(examplePaths[0]);
assert(paidExample.eventType === 'payment.checkout.paid', 'paid example must use payment.checkout.paid');
assert(paidExample.data?.status === 'paid', 'paid example must have paid status');
console.log('Public APICenter consumer contracts are valid.');
