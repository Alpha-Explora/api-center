export type PaymentEnvironment = 'test' | 'live';

export interface TribeClientOptions {
  baseUrl: string;
  apiKey: string;
  tribeId: string;
  environment?: PaymentEnvironment;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface IdempotentRequestOptions extends RequestOptions {
  headers: Record<string, string> & { 'Idempotency-Key': string };
}

export interface Money { amountMinor: number; currency: 'PHP'; }
export interface CreateCheckoutInput {
  referenceId: string;
  amount: Money;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  metadata?: Record<string, string>;
}
export interface Checkout {
  checkoutId: string;
  referenceId: string;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | string;
  amount: Money;
  checkoutUrl?: string;
  aggregateVersion?: number;
}
export interface CreatePaymentIntentInput { referenceId: string; amount: Money; customerId?: string; }
export type ConfirmPaymentIntentInput = Record<string, never>;
export interface PaymentIntent {
  paymentIntentId: string;
  referenceId: string;
  status: 'requires_action' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | string;
  amount: Money;
  aggregateVersion?: number;
}
export interface CreateCustomerInput { customerReference: string; email?: string; name?: string; }
export interface Customer { customerId: string; customerReference: string; email?: string; name?: string; }
export interface CreatePaymentMethodSetupInput { customerId: string; referenceId: string; returnUrl?: string; }
export interface PaymentMethodSetup { setupId: string; customerId: string; status: 'pending' | 'succeeded' | 'failed' | string; returnUrl?: string; }
export interface CreateRefundInput { paymentId: string; amount: Money; reason?: string; }
export interface Refund { refundId: string; paymentId: string; status: 'pending' | 'succeeded' | 'failed' | string; amount: Money; }
export interface CreateSubscriptionInput { customerId: string; referenceId: string; priceId: string; cancelAtPeriodEnd?: boolean; }
export interface CancelSubscriptionInput { cancelAtPeriodEnd?: boolean; reason?: string; }
export interface CancelCheckoutInput { reason?: string; }
export interface Subscription { subscriptionId: string; customerId: string; status: 'active' | 'past_due' | 'cancelled' | 'pending' | string; currentPeriodEnd?: string; }
export interface Invoice { invoiceId: string; status: 'draft' | 'open' | 'paid' | 'past_due' | 'void' | string; amount: Money; }
export interface PaymentCapabilities { currency: 'PHP'; paymentMethods: string[]; resources: string[]; }
export interface ApiErrorDetails { code?: string; message?: string; details?: unknown; status: number; }
