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
export interface PendingResource { status: 'pending'; resourceId: string; }
export type PaymentResource<T> = T | PendingResource;
export interface PaymentCapabilities { currency: 'PHP'; paymentMethods: string[]; resources: string[]; }
export interface ApiErrorDetails { code?: string; message?: string; details?: unknown; status: number; }

export type SharedMessageRecipient = string | { email: string };
export interface EmailSendRequest {
  to: SharedMessageRecipient | SharedMessageRecipient[];
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
export interface EmailSendResponse { messageId: string; status: string; recipient: string[]; }
export interface SmsSendRequest { to: string; message: string; }
export interface SmsSendResponse { messageId: string; recipient: string; status: string; }
export interface SharedMessageStatus { messageId: string; status: string; recipient?: string | string[]; createdAt?: string; metadata?: Record<string, unknown>; }
export interface GoogleAuthorizationUrlRequest { tenantSlug?: string; redirectUri?: string; scopes?: string[]; state?: string; loginHint?: string; accessType?: 'online' | 'offline'; includeGrantedScopes?: boolean; prompt?: string; codeChallenge?: string; codeChallengeMethod?: 'plain' | 'S256'; }
export interface GoogleAuthorizationUrlResponse { authorizationUrl: string; state: string; tenantSlug?: string; credentialSource?: string; expiresAt?: string; }
export interface GoogleTokenExchangeRequest { code: string; codeVerifier?: string; state?: string; tenantSlug?: string; redirectUri?: string; }
export interface GoogleTokenRefreshRequest { refreshToken: string; tenantSlug?: string; redirectUri?: string; }
export interface GoogleOAuthTokenResponse { accessToken: string; refreshToken: string | null; idToken?: string; expiresIn?: number; tokenType?: string; scope?: string; }
export interface GoogleLogoutRequest { token: string; tokenTypeHint?: 'access_token' | 'refresh_token'; }
export interface GoogleLogoutResponse { revoked: boolean; }
export interface OtpGenerateRequest { target: string; channel: 'sms' | 'email'; length?: number; expiresInSeconds?: number; }
export interface OtpGenerateResponse { otpId: string; expiresAt: string; channel: 'sms' | 'email'; target: string; code?: string; }
export interface OtpVerifyRequest { otpId: string; code: string; }
export interface OtpVerifyResponse { valid: boolean; target: string; channel: 'sms' | 'email'; }
export interface OtpStatusResponse { otpId: string; status: string; target: string; channel: 'sms' | 'email'; expiresAt: string; }
export interface GeoGeocodeAddressRequest { address: string; language?: string; region?: string; }
export interface GeoReverseGeocodeRequest { latitude: number; longitude: number; language?: string; resultType?: string; locationType?: string; }
export interface GeoAddressResult { formattedAddress: string; latitude: number; longitude: number; placeId?: string; types: string[]; raw?: unknown; }
export interface GeoFenceCheckRequest { latitude: number; longitude: number; fenceId?: string; fences?: Array<{ fenceId: string; name?: string; latitude: number; longitude: number; radiusMeters: number }>; }
export interface GeoFenceCheckResponse { inside: boolean; distanceDetails: Array<{ fenceId: string; name?: string; inside: boolean; distanceMeters: number; radiusMeters: number }>; }
export interface SharedServiceRequestOptions { headers?: Record<string, string>; signal?: AbortSignal; }
