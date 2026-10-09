import type {
  ApiErrorDetails, Checkout, ConfirmPaymentIntentInput,
  CreateCheckoutInput, CreateCustomerInput, CreatePaymentIntentInput,
  CreateRefundInput, CreateSubscriptionInput, Customer, IdempotentRequestOptions, Invoice,
  PaymentCapabilities, PaymentIntent, PaymentResource, Refund, RequestOptions, Subscription,
  PaymentsClientOptions,
  ListPaymentRecordsOptions, PaymentRecordPage,
} from '../types';

interface ApiEnvelope<T> { success: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown }; }

export class ApiCenterError extends Error {
  readonly details: ApiErrorDetails;
  constructor(message: string, details: ApiErrorDetails) { super(message); this.name = 'ApiCenterError'; this.details = details; }
}

export class PaymentsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PaymentsClientOptions) {
    if (!options.baseUrl.trim() || !options.apiKey.trim()) throw new TypeError('baseUrl and apiKey are required');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  createCheckout(input: CreateCheckoutInput, options: IdempotentRequestOptions): Promise<PaymentResource<Checkout>> { return this.mutate('/checkouts', input, options); }
  getCheckout(id: string, options?: RequestOptions): Promise<Checkout> { return this.read(`/checkouts/${encodeURIComponent(id)}`, options); }
  getCheckoutByReference(id: string, options?: RequestOptions): Promise<Checkout> { return this.read(`/checkouts/by-reference/${encodeURIComponent(id)}`, options); }
  cancelCheckout(id: string, options: IdempotentRequestOptions): Promise<PaymentResource<Checkout>> { return this.mutate(`/checkouts/${encodeURIComponent(id)}/cancel`, undefined, options); }
  createPaymentIntent(input: CreatePaymentIntentInput, options: IdempotentRequestOptions): Promise<PaymentResource<PaymentIntent>> { return this.mutate('/intents', input, options); }
  getPaymentIntent(id: string, options?: RequestOptions): Promise<PaymentIntent> { return this.read(`/intents/${encodeURIComponent(id)}`, options); }
  confirmPaymentIntent(id: string, input: ConfirmPaymentIntentInput, options: IdempotentRequestOptions): Promise<PaymentResource<PaymentIntent>> { return this.mutate(`/intents/${encodeURIComponent(id)}/confirm`, input, options); }
  cancelPaymentIntent(id: string, options: IdempotentRequestOptions): Promise<PaymentResource<PaymentIntent>> { return this.mutate(`/intents/${encodeURIComponent(id)}/cancel`, undefined, options); }
  createCustomer(input: CreateCustomerInput, options: IdempotentRequestOptions): Promise<PaymentResource<Customer>> { return this.mutate('/customers', input, options); }
  getCustomer(id: string, options?: RequestOptions): Promise<Customer> { return this.read(`/customers/${encodeURIComponent(id)}`, options); }
  createRefund(input: CreateRefundInput, options: IdempotentRequestOptions): Promise<PaymentResource<Refund>> { return this.mutate('/refunds', input, options); }
  getRefund(id: string, options?: RequestOptions): Promise<Refund> { return this.read(`/refunds/${encodeURIComponent(id)}`, options); }
  createSubscription(input: CreateSubscriptionInput, options: IdempotentRequestOptions): Promise<PaymentResource<Subscription>> { return this.mutate('/subscriptions', input, options); }
  getSubscription(id: string, options?: RequestOptions): Promise<Subscription> { return this.read(`/subscriptions/${encodeURIComponent(id)}`, options); }
  cancelSubscription(id: string, options: IdempotentRequestOptions): Promise<PaymentResource<Subscription>> { return this.mutate(`/subscriptions/${encodeURIComponent(id)}/cancel`, undefined, options); }
  listSubscriptionInvoices(id: string, options?: RequestOptions): Promise<Invoice[]> { return this.read(`/subscriptions/${encodeURIComponent(id)}/invoices`, options); }
  getInvoice(id: string, options?: RequestOptions): Promise<Invoice> { return this.read(`/invoices/${encodeURIComponent(id)}`, options); }
  getCapabilities(options?: RequestOptions): Promise<PaymentCapabilities> { return this.read('/capabilities', options); }
  getPaymentCapabilities(options?: RequestOptions): Promise<PaymentCapabilities> { return this.getCapabilities(options); }
  listPaymentRecords(options: ListPaymentRecordsOptions = {}): Promise<PaymentRecordPage> {
    const query = new URLSearchParams();
    for (const key of ['type', 'status', 'createdAfter', 'createdBefore', 'limit', 'cursor'] as const) {
      const value = options[key];
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size ? `?${query.toString()}` : '';
    return this.read(`/records${suffix}`, options);
  }

  private read<T>(path: string, options?: RequestOptions): Promise<T> { return this.request<T>(path, { method: 'GET', options }); }
  private mutate<T>(path: string, body: unknown, options: IdempotentRequestOptions): Promise<PaymentResource<T>> {
    if (!options.headers['Idempotency-Key']?.trim()) throw new TypeError('mutating payment operations require a non-empty Idempotency-Key');
    return this.request<T>(path, { method: 'POST', body, options });
  }
  private async request<T>(path: string, request: { method: 'GET' | 'POST'; body?: unknown; options?: RequestOptions }): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json', Authorization: `Bearer ${this.apiKey}`,
      ...(request.options?.headers ?? {}),
    };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/payments${path}`, {
      method: request.method, headers, signal: request.options?.signal,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
    let payload: ApiEnvelope<T>;
    try { payload = (await response.json()) as ApiEnvelope<T>; }
    catch { throw new ApiCenterError(`APICenter payments returned invalid JSON (${response.status})`, { status: response.status }); }
    if ((response.status === 202 || response.ok) && payload.success === true && payload.data !== undefined) return payload.data;
    if (!response.ok || payload.success !== true || payload.data === undefined) {
      const details: ApiErrorDetails = { code: payload.error?.code, message: payload.error?.message, details: payload.error?.details, status: response.status };
      throw new ApiCenterError(details.message ?? `APICenter payments request failed (${response.status})`, details);
    }
    return payload.data;
  }
}
