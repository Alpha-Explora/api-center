import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

const money = z.object({ amountMinor: z.number().int().positive(), currency: z.literal('PHP') });
const reference = z.string().min(1).max(255);
const schemas = {
  checkout: z.object({ referenceId: reference, amount: money, successUrl: z.url(), cancelUrl: z.url(),
    metadata: z.record(z.string(), z.string()).optional() }),
  intent: z.object({ referenceId: reference, amount: money }),
  qrph: z.object({ referenceId: reference, amount: money, description: z.string().max(255).optional(),
    expirySeconds: z.number().int().min(60).max(9000).optional() }),
  paymentLink: z.object({ referenceId: reference, amount: money, description: z.string().max(255).optional(),
    remarks: z.string().max(255).optional(), metadata: z.record(z.string(), z.string()).optional() }),
  archive: z.object({ archive: z.boolean() }),
  customer: z.object({ customerReference: reference, email: z.email(), name: z.string().max(255).optional() }),
  plan: z.object({ name: z.string().trim().min(1).max(255), description: z.string().max(1000).optional(),
    amount: z.number().int().min(2000).max(Number.MAX_SAFE_INTEGER), currency: z.literal('PHP').optional(),
    interval: z.enum(['weekly', 'monthly', 'yearly']), intervalCount: z.number().int().min(1).max(10).optional(),
    cycleCount: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER).optional(), metadata: z.record(z.string(), z.string()).optional() }),
  refund: z.object({ paymentId: z.string().min(1), amount: money, reason: z.string().optional() }),
  subscription: z.object({ customerId: z.string().min(1), referenceId: reference,
    planId: z.string().min(1) }),
  cancellation: z.object({ reason: z.string().optional() }),
  empty: z.object({}),
};

type Shape = keyof typeof schemas;
type Resource = 'checkout' | 'intent' | 'qrph' | 'payment_link' | 'customer' | 'plan' | 'refund' | 'subscription' | 'invoice' | 'capabilities' | 'records';
type Operation = { method: string; pattern: RegExp; scope: string; target: (match: RegExpMatchArray) => string;
  resource: Resource; shape?: Shape };

const operations: Operation[] = [
  { method: 'GET', pattern: /^\/records$/, scope: 'payments:read', target: () => '/payments/records', resource: 'records' },
  { method: 'POST', pattern: /^\/checkouts$/, scope: 'payments:checkout:write', target: () => '/checkout/sessions', resource: 'checkout', shape: 'checkout' },
  { method: 'GET', pattern: /^\/checkouts\/by-reference\/([^/]+)$/, scope: 'payments:checkout:read', target: (m) => `/checkout/sessions/by-reference/${m[1]}`, resource: 'checkout' },
  { method: 'GET', pattern: /^\/checkouts\/([^/]+)$/, scope: 'payments:checkout:read', target: (m) => `/checkout/sessions/${m[1]}`, resource: 'checkout' },
  { method: 'POST', pattern: /^\/checkouts\/([^/]+)\/cancel$/, scope: 'payments:checkout:write', target: (m) => `/checkout/sessions/${m[1]}/cancel`, resource: 'checkout', shape: 'cancellation' },
  { method: 'POST', pattern: /^\/intents$/, scope: 'payments:intents:write', target: () => '/payment-intents', resource: 'intent', shape: 'intent' },
  { method: 'POST', pattern: /^\/intents\/qrph$/, scope: 'payments:intents:write', target: () => '/payment-intents/qrph', resource: 'qrph', shape: 'qrph' },
  { method: 'GET', pattern: /^\/intents\/([^/]+)$/, scope: 'payments:intents:read', target: (m) => `/payment-intents/${m[1]}`, resource: 'intent' },
  { method: 'POST', pattern: /^\/intents\/([^/]+)\/confirm$/, scope: 'payments:intents:write', target: (m) => `/payment-intents/${m[1]}/confirm`, resource: 'intent', shape: 'empty' },
  { method: 'POST', pattern: /^\/intents\/([^/]+)\/cancel$/, scope: 'payments:intents:write', target: (m) => `/payment-intents/${m[1]}/cancel`, resource: 'intent', shape: 'empty' },
  { method: 'POST', pattern: /^\/customers$/, scope: 'payments:customers:write', target: () => '/customers', resource: 'customer', shape: 'customer' },
  { method: 'GET', pattern: /^\/customers\/([^/]+)$/, scope: 'payments:customers:read', target: (m) => `/customers/${m[1]}`, resource: 'customer' },
  { method: 'POST', pattern: /^\/plans$/, scope: 'payments:subscriptions:write', target: () => '/plans', resource: 'plan', shape: 'plan' },
  { method: 'GET', pattern: /^\/plans$/, scope: 'payments:subscriptions:read', target: () => '/plans', resource: 'plan' },
  { method: 'GET', pattern: /^\/plans\/([^/]+)$/, scope: 'payments:subscriptions:read', target: (m) => `/plans/${m[1]}`, resource: 'plan' },
  { method: 'POST', pattern: /^\/payment-links$/, scope: 'payments:payment-links:write', target: () => '/payment-links', resource: 'payment_link', shape: 'paymentLink' },
  { method: 'GET', pattern: /^\/payment-links$/, scope: 'payments:payment-links:read', target: () => '/payment-links', resource: 'payment_link' },
  { method: 'GET', pattern: /^\/payment-links\/([^/]+)$/, scope: 'payments:payment-links:read', target: (m) => `/payment-links/${m[1]}`, resource: 'payment_link' },
  { method: 'PATCH', pattern: /^\/payment-links\/([^/]+)$/, scope: 'payments:payment-links:write', target: (m) => `/payment-links/${m[1]}`, resource: 'payment_link', shape: 'archive' },
  { method: 'POST', pattern: /^\/refunds$/, scope: 'payments:refunds:write', target: () => '/refunds', resource: 'refund', shape: 'refund' },
  { method: 'GET', pattern: /^\/refunds\/([^/]+)$/, scope: 'payments:refunds:read', target: (m) => `/refunds/${m[1]}`, resource: 'refund' },
  { method: 'POST', pattern: /^\/subscriptions$/, scope: 'payments:subscriptions:write', target: () => '/subscriptions', resource: 'subscription', shape: 'subscription' },
  { method: 'GET', pattern: /^\/subscriptions\/([^/]+)$/, scope: 'payments:subscriptions:read', target: (m) => `/subscriptions/${m[1]}`, resource: 'subscription' },
  { method: 'POST', pattern: /^\/subscriptions\/([^/]+)\/cancel$/, scope: 'payments:subscriptions:write', target: (m) => `/subscriptions/${m[1]}/cancel`, resource: 'subscription', shape: 'cancellation' },
  { method: 'GET', pattern: /^\/subscriptions\/([^/]+)\/invoices$/, scope: 'payments:subscriptions:read', target: (m) => `/subscriptions/${m[1]}/invoices`, resource: 'invoice' },
  { method: 'GET', pattern: /^\/invoices\/([^/]+)$/, scope: 'payments:invoices:read', target: (m) => `/invoices/${m[1]}`, resource: 'invoice' },
  { method: 'GET', pattern: /^\/capabilities$/, scope: 'payments:read', target: () => '', resource: 'capabilities' },
];

/** Resolve a public payment route to its authorized runtime operation. */
export function resolvePaymentOperation(method: string, path: string) {
  const operation = operations.find((candidate) => candidate.method === method.toUpperCase()
    && candidate.pattern.test(path));
  if (!operation) throw new NotFoundException({ code: 'PAYMENT_OPERATION_NOT_FOUND', message: 'Payment operation not found' });
  const match = path.match(operation.pattern)!;
  return { ...operation, runtimePath: operation.target(match) };
}

/** Validate and translate a public payment request before proxying it to the runtime. */
export function paymentRequestBody(shape: Shape | undefined, input: unknown, serviceId: string): unknown {
  if (!shape) return undefined;
  const result = schemas[shape].safeParse(input || {});
  if (!result.success) throw new BadRequestException({ code: 'INVALID_PAYMENT_REQUEST',
    message: 'Payment request does not match the public contract' });
  const data = result.data as Record<string, unknown>;
  if (data.amount && typeof data.amount === 'object') {
    const moneyValue = data.amount as { amountMinor: number; currency: 'PHP' };
    data.currency = moneyValue.currency;
    data.amount = moneyValue.amountMinor;
  }
  if (shape === 'checkout') {
    const metadata = data.metadata && typeof data.metadata === 'object'
      ? data.metadata as Record<string, string>
      : {};
    data.metadata = { ...metadata, __apicenterConsumerServiceId: serviceId };
  }
  return data;
}

function amount(value: unknown, currency = 'PHP') {
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    return { amountMinor: raw.amountMinor ?? raw.value ?? raw.amount,
      currency: typeof raw.currency === 'string' ? raw.currency : currency };
  }
  return { amountMinor: value, currency };
}

function responseCurrency(raw: Record<string, unknown>): string | undefined {
  return typeof raw.currency === 'string' ? raw.currency : undefined;
}

/** Project a runtime result onto the provider-neutral public payment response shape. */
export function paymentResponseBody(resource: Resource, upstream: unknown): unknown {
  if (!upstream || typeof upstream !== 'object') return upstream;
  const envelope = upstream as { success?: boolean; data?: unknown; error?: unknown };
  if (!envelope.success || !envelope.data) return upstream;
  const map = (value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    const raw = value as Record<string, unknown>;
    switch (resource) {
      case 'checkout': return { checkoutId: raw.checkoutId, referenceId: raw.referenceId,
        status: raw.status === 'active' ? 'pending' : raw.status, amount: amount(raw.amount, responseCurrency(raw)), checkoutUrl: raw.checkoutUrl || raw.redirectUrl,
        aggregateVersion: raw.aggregateVersion };
      case 'intent': return { paymentIntentId: raw.paymentIntentId, referenceId: raw.referenceId,
        status: raw.status === 'awaiting_payment_method' ? 'requires_action' : raw.status,
        amount: amount(raw.amount, responseCurrency(raw)), aggregateVersion: raw.aggregateVersion };
      case 'qrph': return { paymentIntentId: raw.paymentIntentId, referenceId: raw.referenceId, status: raw.status,
        amount: amount(raw.amount, responseCurrency(raw)), qrCodeImageUrl: raw.qrCodeImageUrl, expirySeconds: raw.expirySeconds };
      case 'payment_link': return { paymentLinkId: raw.paymentLinkId, referenceId: raw.referenceId,
        amount: amount(raw.amount, responseCurrency(raw)), description: raw.description, url: raw.url,
        status: raw.status, active: raw.active, archived: raw.archived, referenceNumber: raw.referenceNumber,
        metadata: raw.metadata, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
      case 'customer': return { customerId: raw.customerId, customerReference: raw.customerReference,
        email: raw.email, name: raw.name };
      case 'plan': return { planId: raw.planId, name: raw.name,
        description: raw.description, amount: raw.amount, currency: raw.currency, interval: raw.interval,
        intervalCount: raw.intervalCount, cycleCount: raw.cycleCount, metadata: raw.metadata };
      case 'refund': return { refundId: raw.refundId, paymentId: raw.paymentId,
        status: raw.status, amount: amount(raw.amount, responseCurrency(raw)) };
      case 'subscription': return { subscriptionId: raw.subscriptionId, customerId: raw.customerId,
        planId: raw.planId, status: raw.status, currentPeriodEnd: raw.currentPeriodEnd };
      case 'invoice': return { invoiceId: raw.invoiceId, status: raw.status,
        amount: amount(raw.amount, responseCurrency(raw)) };
      default: return raw;
    }
  };
  return { success: true, data: Array.isArray(envelope.data) ? envelope.data.map(map) : map(envelope.data) };
}
