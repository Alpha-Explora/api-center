import type {
  ApiErrorDetails, CancelCheckoutInput, CancelSubscriptionInput, Checkout, ConfirmPaymentIntentInput,
  CreateCheckoutInput, CreateCustomerInput, CreatePaymentIntentInput, CreatePaymentMethodSetupInput,
  CreateRefundInput, CreateSubscriptionInput, Customer, IdempotentRequestOptions, Invoice,
  PaymentCapabilities, PaymentIntent, PaymentMethodSetup, Refund, RequestOptions, Subscription,
  TribeClientOptions,
} from '../types';

interface ApiEnvelope<T> { success: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown }; }

export class ApiCenterError extends Error {
  readonly details: ApiErrorDetails;
  constructor(message: string, details: ApiErrorDetails) { super(message); this.name = 'ApiCenterError'; this.details = details; }
}

export class PaymentsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tribeId: string;
  private readonly environment: 'test' | 'live';
  private readonly fetchImpl: typeof fetch;

  constructor(options: TribeClientOptions) {
    if (!options.baseUrl.trim() || !options.apiKey.trim() || !options.tribeId.trim()) throw new TypeError('baseUrl, apiKey, and tribeId are required');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.tribeId = options.tribeId;
    this.environment = options.environment ?? 'test';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  createCheckout(input: CreateCheckoutInput, options: IdempotentRequestOptions): Promise<Checkout> { return this.mutate('/checkouts', input, options); }
  getCheckout(id: string, options?: RequestOptions): Promise<Checkout> { return this.read(`/checkouts/${encodeURIComponent(id)}`, options); }
  getCheckoutByReference(id: string, options?: RequestOptions): Promise<Checkout> { return this.read(`/checkouts/by-reference/${encodeURIComponent(id)}`, options); }
  cancelCheckout(id: string, input: CancelCheckoutInput, options: IdempotentRequestOptions): Promise<Checkout> { return this.mutate(`/checkouts/${encodeURIComponent(id)}/cancel`, input, options); }
  createPaymentIntent(input: CreatePaymentIntentInput, options: IdempotentRequestOptions): Promise<PaymentIntent> { return this.mutate('/intents', input, options); }
  getPaymentIntent(id: string, options?: RequestOptions): Promise<PaymentIntent> { return this.read(`/intents/${encodeURIComponent(id)}`, options); }
  confirmPaymentIntent(id: string, input: ConfirmPaymentIntentInput, options: IdempotentRequestOptions): Promise<PaymentIntent> { return this.mutate(`/intents/${encodeURIComponent(id)}/confirm`, input, options); }
  cancelPaymentIntent(id: string, options: IdempotentRequestOptions): Promise<PaymentIntent> { return this.mutate(`/intents/${encodeURIComponent(id)}/cancel`, undefined, options); }
  createCustomer(input: CreateCustomerInput, options: IdempotentRequestOptions): Promise<Customer> { return this.mutate('/customers', input, options); }
  getCustomer(id: string, options?: RequestOptions): Promise<Customer> { return this.read(`/customers/${encodeURIComponent(id)}`, options); }
  createPaymentMethodSetup(input: CreatePaymentMethodSetupInput, options: IdempotentRequestOptions): Promise<PaymentMethodSetup> { return this.mutate('/payment-method-setups', input, options); }
  createRefund(input: CreateRefundInput, options: IdempotentRequestOptions): Promise<Refund> { return this.mutate('/refunds', input, options); }
  getRefund(id: string, options?: RequestOptions): Promise<Refund> { return this.read(`/refunds/${encodeURIComponent(id)}`, options); }
  createSubscription(input: CreateSubscriptionInput, options: IdempotentRequestOptions): Promise<Subscription> { return this.mutate('/subscriptions', input, options); }
  getSubscription(id: string, options?: RequestOptions): Promise<Subscription> { return this.read(`/subscriptions/${encodeURIComponent(id)}`, options); }
  cancelSubscription(id: string, input: CancelSubscriptionInput, options: IdempotentRequestOptions): Promise<Subscription> { return this.mutate(`/subscriptions/${encodeURIComponent(id)}/cancel`, input, options); }
  listSubscriptionInvoices(id: string, options?: RequestOptions): Promise<Invoice[]> { return this.read(`/subscriptions/${encodeURIComponent(id)}/invoices`, options); }
  getInvoice(id: string, options?: RequestOptions): Promise<Invoice> { return this.read(`/invoices/${encodeURIComponent(id)}`, options); }
  getCapabilities(options?: RequestOptions): Promise<PaymentCapabilities> { return this.read('/capabilities', options); }
  getPaymentCapabilities(options?: RequestOptions): Promise<PaymentCapabilities> { return this.getCapabilities(options); }

  private read<T>(path: string, options?: RequestOptions): Promise<T> { return this.request<T>(path, { method: 'GET', options }); }
  private mutate<T>(path: string, body: unknown, options: IdempotentRequestOptions): Promise<T> {
    if (!options.headers['Idempotency-Key']?.trim()) throw new TypeError('mutating payment operations require a non-empty Idempotency-Key');
    return this.request<T>(path, { method: 'POST', body, options });
  }
  private async request<T>(path: string, request: { method: 'GET' | 'POST'; body?: unknown; options?: RequestOptions }): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json', Authorization: `Bearer ${this.apiKey}`, 'X-Tribe-ID': this.tribeId,
      'X-APICenter-Environment': this.environment, ...(request.options?.headers ?? {}),
    };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/payments${path}`, {
      method: request.method, headers, signal: request.options?.signal,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
    let payload: ApiEnvelope<T>;
    try { payload = (await response.json()) as ApiEnvelope<T>; }
    catch { throw new ApiCenterError(`APICenter payments returned invalid JSON (${response.status})`, { status: response.status }); }
    if (!response.ok || payload.success !== true || payload.data === undefined) {
      const details: ApiErrorDetails = { code: payload.error?.code, message: payload.error?.message, details: payload.error?.details, status: response.status };
      throw new ApiCenterError(details.message ?? `APICenter payments request failed (${response.status})`, details);
    }
    return payload.data;
  }
}
