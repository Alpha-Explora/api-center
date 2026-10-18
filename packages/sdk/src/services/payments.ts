import type {
  Checkout,
  ConfirmPaymentIntentInput,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePaymentIntentInput,
  CreatePaymentLinkInput,
  CreatePlanInput,
  CreateQrPhPaymentIntentInput,
  CreateRefundInput,
  CreateSubscriptionInput,
  Customer,
  Invoice,
  ListPaymentRecordsOptions,
  PaymentCapabilities,
  PaymentIntent,
  PaymentLink,
  PaymentRecordPage,
  PaymentResource,
  Plan,
  QrPhPaymentIntent,
  Refund,
  Subscription,
} from '@alpha-explora/apicenter-contracts';
import { ApiCenterTransport } from '../internal/transport';
import type { IdempotencyOptions, RequestOptions } from '../types';

type RecordListOptions = ListPaymentRecordsOptions & RequestOptions;

export class PaymentsNamespace {
  readonly checkouts: CheckoutClient;
  readonly intents: IntentClient;
  readonly customers: CustomerClient;
  readonly plans: PlanClient;
  readonly paymentLinks: PaymentLinkClient;
  readonly refunds: RefundClient;
  readonly subscriptions: SubscriptionClient;
  readonly invoices: InvoiceClient;
  readonly records: PaymentRecordsClient;
  readonly capabilities: PaymentCapabilitiesClient;

  constructor(private readonly transport: ApiCenterTransport) {
    this.checkouts = new CheckoutClient(transport);
    this.intents = new IntentClient(transport);
    this.customers = new CustomerClient(transport);
    this.plans = new PlanClient(transport);
    this.paymentLinks = new PaymentLinkClient(transport);
    this.refunds = new RefundClient(transport);
    this.subscriptions = new SubscriptionClient(transport);
    this.invoices = new InvoiceClient(transport);
    this.records = new PaymentRecordsClient(transport);
    this.capabilities = new PaymentCapabilitiesClient(transport);
  }
}

class CheckoutClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createCheckout POST /api/v1/payments/checkouts */
  create(input: CreateCheckoutInput, options: IdempotencyOptions): Promise<PaymentResource<Checkout>> {
    return this.mutate('/checkouts', input, options);
  }

  /** @sdk-operation getCheckout GET /api/v1/payments/checkouts/{checkoutId} */
  get(checkoutId: string, options?: RequestOptions): Promise<Checkout> {
    return this.read(`/checkouts/${encodeURIComponent(checkoutId)}`, options);
  }

  /** @sdk-operation getCheckoutByReference GET /api/v1/payments/checkouts/by-reference/{referenceId} */
  getByReference(referenceId: string, options?: RequestOptions): Promise<Checkout> {
    return this.read(`/checkouts/by-reference/${encodeURIComponent(referenceId)}`, options);
  }

  /** @sdk-operation cancelCheckout POST /api/v1/payments/checkouts/{checkoutId}/cancel */
  cancel(checkoutId: string, options: IdempotencyOptions, input?: { reason?: string }): Promise<PaymentResource<Checkout>> {
    return this.mutate(`/checkouts/${encodeURIComponent(checkoutId)}/cancel`, input, options);
  }

  private read<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'GET', credential: 'payment', options });
  }

  private mutate<T>(path: string, body: unknown, options: IdempotencyOptions): Promise<PaymentResource<T>> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'POST', credential: 'payment', body, idempotencyKey: options.idempotencyKey, options });
  }
}

class IntentClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createPaymentIntent POST /api/v1/payments/intents */
  create(input: CreatePaymentIntentInput, options: IdempotencyOptions): Promise<PaymentResource<PaymentIntent>> {
    return this.mutate('/intents', input, options);
  }

  /** @sdk-operation createQrPhPaymentIntent POST /api/v1/payments/intents/qrph */
  createQrPh(input: CreateQrPhPaymentIntentInput, options: IdempotencyOptions): Promise<PaymentResource<QrPhPaymentIntent>> {
    return this.mutate('/intents/qrph', input, options);
  }

  /** @sdk-operation getPaymentIntent GET /api/v1/payments/intents/{paymentIntentId} */
  get(paymentIntentId: string, options?: RequestOptions): Promise<PaymentIntent> {
    return this.read(`/intents/${encodeURIComponent(paymentIntentId)}`, options);
  }

  /** @sdk-operation confirmPaymentIntent POST /api/v1/payments/intents/{paymentIntentId}/confirm */
  confirm(paymentIntentId: string, input: ConfirmPaymentIntentInput, options: IdempotencyOptions): Promise<PaymentResource<PaymentIntent>> {
    return this.mutate(`/intents/${encodeURIComponent(paymentIntentId)}/confirm`, input, options);
  }

  /** @sdk-operation cancelPaymentIntent POST /api/v1/payments/intents/{paymentIntentId}/cancel */
  cancel(paymentIntentId: string, options: IdempotencyOptions): Promise<PaymentResource<PaymentIntent>> {
    return this.mutate(`/intents/${encodeURIComponent(paymentIntentId)}/cancel`, {}, options);
  }

  private read<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'GET', credential: 'payment', options });
  }

  private mutate<T>(path: string, body: unknown, options: IdempotencyOptions): Promise<PaymentResource<T>> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'POST', credential: 'payment', body, idempotencyKey: options.idempotencyKey, options });
  }
}

class CustomerClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createCustomer POST /api/v1/payments/customers */
  create(input: CreateCustomerInput, options: IdempotencyOptions): Promise<PaymentResource<Customer>> {
    return this.mutate('/customers', input, options);
  }

  /** @sdk-operation getCustomer GET /api/v1/payments/customers/{customerId} */
  get(customerId: string, options?: RequestOptions): Promise<Customer> {
    return this.transport.request({ path: `/api/v1/payments/customers/${encodeURIComponent(customerId)}`, method: 'GET', credential: 'payment', options });
  }

  private mutate<T>(path: string, body: unknown, options: IdempotencyOptions): Promise<PaymentResource<T>> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'POST', credential: 'payment', body, idempotencyKey: options.idempotencyKey, options });
  }
}

class PlanClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createPlan POST /api/v1/payments/plans */
  create(input: CreatePlanInput, options: IdempotencyOptions): Promise<PaymentResource<Plan>> {
    return this.transport.request({ path: '/api/v1/payments/plans', method: 'POST', credential: 'payment', body: input, idempotencyKey: options.idempotencyKey, options });
  }

  /** @sdk-operation getPlan GET /api/v1/payments/plans/{planId} */
  get(planId: string, options?: RequestOptions): Promise<Plan> {
    return this.transport.request({ path: `/api/v1/payments/plans/${encodeURIComponent(planId)}`, method: 'GET', credential: 'payment', options });
  }

  /** @sdk-operation listPlans GET /api/v1/payments/plans */
  list(options?: RequestOptions): Promise<Plan[]> {
    return this.transport.request({ path: '/api/v1/payments/plans', method: 'GET', credential: 'payment', options });
  }
}

class PaymentLinkClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createPaymentLink POST /api/v1/payments/payment-links */
  create(input: CreatePaymentLinkInput, options: IdempotencyOptions): Promise<PaymentResource<PaymentLink>> {
    return this.mutate('/payment-links', input, options);
  }

  /** @sdk-operation listPaymentLinks GET /api/v1/payments/payment-links */
  list(options?: RequestOptions): Promise<PaymentLink[]> {
    return this.transport.request({ path: '/api/v1/payments/payment-links', method: 'GET', credential: 'payment', options });
  }

  /** @sdk-operation getPaymentLink GET /api/v1/payments/payment-links/{paymentLinkId} */
  get(paymentLinkId: string, options?: RequestOptions): Promise<PaymentLink> {
    return this.transport.request({ path: `/api/v1/payments/payment-links/${encodeURIComponent(paymentLinkId)}`, method: 'GET', credential: 'payment', options });
  }

  /** @sdk-operation setPaymentLinkArchived PATCH /api/v1/payments/payment-links/{paymentLinkId} */
  archive(paymentLinkId: string, options: IdempotencyOptions): Promise<PaymentResource<PaymentLink>> {
    return this.mutate(`/payment-links/${encodeURIComponent(paymentLinkId)}`, { archive: true }, options, 'PATCH');
  }

  /** @sdk-operation setPaymentLinkArchived PATCH /api/v1/payments/payment-links/{paymentLinkId} */
  unarchive(paymentLinkId: string, options: IdempotencyOptions): Promise<PaymentResource<PaymentLink>> {
    return this.mutate(`/payment-links/${encodeURIComponent(paymentLinkId)}`, { archive: false }, options, 'PATCH');
  }

  private mutate<T>(path: string, body: unknown, options: IdempotencyOptions, method: 'POST' | 'PATCH' = 'POST'): Promise<PaymentResource<T>> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method, credential: 'payment', body, idempotencyKey: options.idempotencyKey, options });
  }
}

class RefundClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createRefund POST /api/v1/payments/refunds */
  create(input: CreateRefundInput, options: IdempotencyOptions): Promise<PaymentResource<Refund>> {
    return this.transport.request({ path: '/api/v1/payments/refunds', method: 'POST', credential: 'payment', body: input, idempotencyKey: options.idempotencyKey, options });
  }

  /** @sdk-operation getRefund GET /api/v1/payments/refunds/{refundId} */
  get(refundId: string, options?: RequestOptions): Promise<Refund> {
    return this.transport.request({ path: `/api/v1/payments/refunds/${encodeURIComponent(refundId)}`, method: 'GET', credential: 'payment', options });
  }
}

class SubscriptionClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation createSubscription POST /api/v1/payments/subscriptions */
  create(input: CreateSubscriptionInput, options: IdempotencyOptions): Promise<PaymentResource<Subscription>> {
    return this.mutate('/subscriptions', input, options);
  }

  /** @sdk-operation getSubscription GET /api/v1/payments/subscriptions/{subscriptionId} */
  get(subscriptionId: string, options?: RequestOptions): Promise<Subscription> {
    return this.read(`/subscriptions/${encodeURIComponent(subscriptionId)}`, options);
  }

  /** @sdk-operation cancelSubscription POST /api/v1/payments/subscriptions/{subscriptionId}/cancel */
  cancel(subscriptionId: string, options: IdempotencyOptions, input?: { reason?: string }): Promise<PaymentResource<Subscription>> {
    return this.mutate(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, input, options);
  }

  /** @sdk-operation listSubscriptionInvoices GET /api/v1/payments/subscriptions/{subscriptionId}/invoices */
  listInvoices(subscriptionId: string, options?: RequestOptions): Promise<Invoice[]> {
    return this.read(`/subscriptions/${encodeURIComponent(subscriptionId)}/invoices`, options);
  }

  private read<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'GET', credential: 'payment', options });
  }

  private mutate<T>(path: string, body: unknown, options: IdempotencyOptions): Promise<PaymentResource<T>> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'POST', credential: 'payment', body, idempotencyKey: options.idempotencyKey, options });
  }
}

class InvoiceClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation getInvoice GET /api/v1/payments/invoices/{invoiceId} */
  get(invoiceId: string, options?: RequestOptions): Promise<Invoice> {
    return this.transport.request({ path: `/api/v1/payments/invoices/${encodeURIComponent(invoiceId)}`, method: 'GET', credential: 'payment', options });
  }
}

class PaymentRecordsClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation listPaymentRecords GET /api/v1/payments/records */
  list(options: RecordListOptions = {}): Promise<PaymentRecordPage> {
    const query = new URLSearchParams();
    for (const key of ['type', 'status', 'createdAfter', 'createdBefore', 'limit', 'cursor'] as const) {
      const value = options[key];
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size ? `?${query.toString()}` : '';
    return this.transport.request({
      path: `/api/v1/payments/records${suffix}`, method: 'GET', credential: 'payment', options,
    });
  }
}

class PaymentCapabilitiesClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation getPaymentCapabilities GET /api/v1/payments/capabilities */
  get(options?: RequestOptions): Promise<PaymentCapabilities> {
    return this.transport.request({ path: '/api/v1/payments/capabilities', method: 'GET', credential: 'payment', options });
  }
}
