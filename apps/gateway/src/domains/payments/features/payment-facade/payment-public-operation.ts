import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

export const PAYMENT_METHODS = ['card', 'gcash', 'paymaya', 'qrph'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
const WALLET_METHODS = ['gcash', 'paymaya'] as const;

/**
 * The methods an environment offers: APICENTER_PAYMENT_METHODS_TEST / _LIVE, comma-separated. A method
 * the PayMongo account is not approved for belongs out of the list, so apps can hide it.
 */
export function enabledPaymentMethods(environment: 'test' | 'live', env: NodeJS.ProcessEnv = process.env): PaymentMethod[] {
  const configured = env[`APICENTER_PAYMENT_METHODS_${environment.toUpperCase()}`];
  if (configured === undefined) return [...PAYMENT_METHODS];
  const listed = new Set(configured.split(',').map((method) => method.trim()));
  return PAYMENT_METHODS.filter((method) => listed.has(method));
}

const money = z.object({ amountMinor: z.number().int().positive(), currency: z.literal('PHP') });
const reference = z.string().min(1).max(255);
const link = z.string().min(1).max(2048);
const schemas = {
  checkout: z.object({ referenceId: reference, amount: money, successUrl: link, cancelUrl: link,
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).max(PAYMENT_METHODS.length).optional(),
    metadata: z.record(z.string(), z.string()).optional() }),
  // A wallet intent names its wallet and where the wallet returns the customer; a plain intent has neither.
  intent: z.object({ referenceId: reference, amount: money, paymentMethod: z.enum(WALLET_METHODS).optional(),
    returnUrl: link.optional(), description: z.string().max(255).optional(),
    billing: z.object({ name: z.string().trim().min(1).max(255).optional(), email: z.email().optional(),
      phone: z.string().trim().min(1).max(32).optional() }).optional() })
    .refine((intent) => !intent.paymentMethod === !intent.returnUrl),
  qrph: z.object({ referenceId: reference, amount: money, description: z.string().max(255).optional(),
    expirySeconds: z.number().int().min(60).max(9000).optional() }),
  paymentLink: z.object({ referenceId: reference, amount: money, description: z.string().trim().min(1).max(255),
    remarks: z.string().max(255).optional(), metadata: z.record(z.string(), z.string()).optional() }),
  archive: z.object({ archive: z.boolean() }),
  customer: z.object({ customerReference: reference, email: z.email(), name: z.string().max(255).optional() }),
  plan: z.object({ name: z.string().trim().min(1).max(255), description: z.string().max(1000).optional(),
    amount: z.number().int().min(2000).max(Number.MAX_SAFE_INTEGER), currency: z.literal('PHP').optional(),
    interval: z.enum(['weekly', 'monthly', 'yearly']), intervalCount: z.number().int().min(1).max(10).optional(),
    cycleCount: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER).optional(), metadata: z.record(z.string(), z.string()).optional() }),
  refund: z.object({ paymentId: z.string().min(1), amount: money, reason: z.string().optional() }),
  intentConfirmation: z.object({ paymentMethodId: z.string().min(1), clientKey: z.string().min(1), returnUrl: link }),
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
  { method: 'POST', pattern: /^\/intents\/([^/]+)\/confirm$/, scope: 'payments:intents:write', target: (m) => `/payment-intents/${m[1]}/confirm`, resource: 'intent', shape: 'intentConfirmation' },
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

export interface PaymentRequestContext {
  serviceId: string;
  enabledMethods: readonly PaymentMethod[];
  /** The link to hand the provider for a customer-facing return URL. */
  returnLink: (url: string) => string;
}

function assertEnabled(methods: readonly string[], enabled: readonly PaymentMethod[]) {
  const unavailable = methods.filter((method) => !enabled.includes(method as PaymentMethod));
  if (unavailable.length) throw new BadRequestException({ code: 'PAYMENT_METHOD_UNAVAILABLE',
    message: `Not enabled for this environment: ${unavailable.join(', ')}` });
}

/** Validate and translate a public payment request before proxying it to the runtime. */
export function paymentRequestBody(shape: Shape | undefined, input: unknown, context: PaymentRequestContext): unknown {
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
    data.metadata = { ...metadata, __apicenterConsumerServiceId: context.serviceId };
    data.successUrl = context.returnLink(data.successUrl as string);
    data.cancelUrl = context.returnLink(data.cancelUrl as string);
    if (data.paymentMethods) {
      assertEnabled(data.paymentMethods as string[], context.enabledMethods);
      data.paymentMethodsAllowed = data.paymentMethods;
      delete data.paymentMethods;
    }
  }
  if (shape === 'intent' && data.paymentMethod) {
    assertEnabled([data.paymentMethod as string], context.enabledMethods);
    data.returnUrl = context.returnLink(data.returnUrl as string);
  }
  if (shape === 'qrph') assertEnabled(['qrph'], context.enabledMethods);
  if (shape === 'intentConfirmation') {
    return { payment_method: data.paymentMethodId, client_key: data.clientKey,
      return_url: context.returnLink(data.returnUrl as string) };
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
        status: raw.status === 'awaiting_payment_method' || raw.status === 'awaiting_next_action' ? 'requires_action' : raw.status,
        amount: amount(raw.amount, responseCurrency(raw)), aggregateVersion: raw.aggregateVersion,
        clientKey: raw.clientKey, nextAction: raw.nextAction, paymentMethod: raw.paymentMethod,
        lastPaymentError: raw.lastPaymentError };
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
