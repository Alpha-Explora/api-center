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
assert(openApi.security?.[0]?.ApiKeyAuth, 'OpenAPI must require ApiKeyAuth globally');
assert(openApi.components?.headers?.['Idempotency-Key'], 'Idempotency-Key header is missing');

const requiredOperations: Record<string, string> = {
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
  'POST /api/v1/payments/payment-method-setups': 'createPaymentMethodSetup',
  'POST /api/v1/payments/refunds': 'createRefund',
  'GET /api/v1/payments/refunds/{refundId}': 'getRefund',
  'POST /api/v1/payments/subscriptions': 'createSubscription',
  'GET /api/v1/payments/subscriptions/{subscriptionId}': 'getSubscription',
  'POST /api/v1/payments/subscriptions/{subscriptionId}/cancel': 'cancelSubscription',
  'GET /api/v1/payments/subscriptions/{subscriptionId}/invoices': 'listSubscriptionInvoices',
  'GET /api/v1/payments/invoices/{invoiceId}': 'getInvoice',
  'GET /api/v1/payments/capabilities': 'getPaymentCapabilities',
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
  assert(route.startsWith('/api/v1/payments/'), `${route} is outside the public payment namespace`);
  for (const [method, operation] of Object.entries<RecordValue>(pathItem)) {
    if (!['post', 'put', 'patch', 'delete'].includes(method)) continue;
    assert((operation.parameters ?? []).some((parameter: RecordValue) => parameter.$ref === '#/components/headers/Idempotency-Key'), `${method.toUpperCase()} ${route} must declare Idempotency-Key`);
  }
}
const serializedOpenApi = JSON.stringify(openApi).toLowerCase();
assert(!serializedOpenApi.includes('paymongo_') && !serializedOpenApi.includes('paymongoid'), 'public HTTP contract leaks provider-specific fields');
assert(openApi.components?.schemas?.CheckoutCreateRequest?.properties?.metadata?.additionalProperties?.type === 'string', 'Checkout metadata must be string-valued correlation metadata');

const channel = asyncApi.channels?.['apicenter.payment-events.{environment}'];
assert(channel, 'payment event channel is missing');
assert(channel['x-apicenter-consumer-filter']?.attribute === 'consumerServiceId', 'event channel must filter by consumerServiceId');
assert(channel['x-apicenter-push-delivery']?.authentication === 'oidc', 'event delivery must use OIDC push authentication');
assert(channel['x-apicenter-push-delivery']?.maxDeliveryAttempts === 20, 'event delivery must define a 20-attempt dead-letter policy');
const paymentEvent = asyncApi.components?.schemas?.PaymentEvent;
const requiredEnvelopeFields = ['eventId', 'contractVersion', 'eventType', 'ownerTribeId', 'consumerServiceId', 'referenceId', 'aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', 'data'];
for (const field of requiredEnvelopeFields) assert(paymentEvent?.required?.includes(field), `PaymentEvent must require ${field}`);
const checkoutSnapshot = asyncApi.components?.schemas?.CheckoutSnapshot;
for (const field of ['checkoutId', 'referenceId', 'status', 'amount', 'aggregateVersion']) assert(checkoutSnapshot?.required?.includes(field), `CheckoutSnapshot must require ${field}`);

const examplePaths = ['contracts/public/examples/payment-checkout-created.json', 'contracts/public/examples/payment-checkout-paid-event.json'];
for (const relativePath of examplePaths) {
  const example = readJson(relativePath);
  for (const field of requiredEnvelopeFields) assert(example[field] !== undefined, `${relativePath} is missing ${field}`);
  assert(example.contractVersion === '1.0', `${relativePath} must use contractVersion 1.0`);
  assert(['test', 'live'].includes(example.data?.environment), `${relativePath} has an invalid environment`);
  assert(example.data?.aggregateVersion === example.aggregateVersion, `${relativePath} data aggregateVersion must match envelope`);
}
const paidExample = readJson(examplePaths[1]);
assert(paidExample.eventType === 'payment.checkout.paid', 'paid example must use payment.checkout.paid');
assert(paidExample.data?.status === 'paid', 'paid example must have paid status');
console.log('Public APICenter payment contracts are valid.');