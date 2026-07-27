export type PaymentEnvironment = "test" | "live";

export interface PaymentsClientOptions {
  baseUrl: string;
  apiKey: string;
  tribeId: string;
  environment?: PaymentEnvironment;
  fetchImpl?: typeof fetch;
}

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface CheckoutCreateInput {
  referenceId: string;
  amount: Money;
  successUrl: string;
  cancelUrl: string;
  lineItems?: Array<{ name: string; quantity: number; amount: Money; description?: string }>;
  metadata?: Record<string, string>;
}

export interface Checkout {
  checkoutId: string;
  status: string;
  redirectUrl?: string;
  referenceId?: string;
  amount?: Money;
  [key: string]: unknown;
}

export interface RefundCreateInput {
  paymentId: string;
  amount: Money;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface CustomerCreateInput {
  customerId?: string;
  email?: string;
  phone?: string;
  name?: string;
  metadata?: Record<string, string>;
}

export interface SubscriptionCreateInput {
  referenceId: string;
  customerId: string;
  priceId: string;
  metadata?: Record<string, string>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code?: string; message?: string; details?: unknown };
}

export class PaymentsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tribeId: string;
  private readonly environment: PaymentEnvironment;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PaymentsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.tribeId = options.tribeId;
    this.environment = options.environment ?? "test";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  createCheckout(input: CheckoutCreateInput, idempotencyKey: string): Promise<Checkout> {
    return this.request("/checkouts", { method: "POST", body: input, idempotencyKey });
  }

  getCheckout(checkoutId: string): Promise<Checkout> {
    return this.request(`/checkouts/${encodeURIComponent(checkoutId)}`);
  }

  getCheckoutByReference(referenceId: string): Promise<Checkout> {
    return this.request(`/checkouts/by-reference/${encodeURIComponent(referenceId)}`);
  }

  cancelCheckout(checkoutId: string, idempotencyKey: string, reason?: string): Promise<Checkout> {
    return this.request(`/checkouts/${encodeURIComponent(checkoutId)}/cancel`, {
      method: "POST",
      body: reason ? { reason } : undefined,
      idempotencyKey,
    });
  }

  createRefund(input: RefundCreateInput, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.request("/refunds", { method: "POST", body: input, idempotencyKey });
  }

  createCustomer(input: CustomerCreateInput, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.request("/customers", { method: "POST", body: input, idempotencyKey });
  }

  getCustomer(customerId: string): Promise<Record<string, unknown>> {
    return this.request(`/customers/${encodeURIComponent(customerId)}`);
  }

  createSubscription(input: SubscriptionCreateInput, idempotencyKey: string): Promise<Record<string, unknown>> {
    return this.request("/subscriptions", { method: "POST", body: input, idempotencyKey });
  }

  getSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  cancelSubscription(subscriptionId: string, idempotencyKey: string, cancelAtPeriodEnd = true): Promise<Record<string, unknown>> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
      body: { cancelAtPeriodEnd },
      idempotencyKey,
    });
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/payments${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-Tribe-ID": this.tribeId,
        "X-APICenter-Environment": this.environment,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !payload.success) {
      const error = new Error(payload.error?.message ?? `APICenter payments request failed (${response.status})`);
      Object.assign(error, { code: payload.error?.code, status: response.status, details: payload.error?.details });
      throw error;
    }
    return payload.data;
  }
}
