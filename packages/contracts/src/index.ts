/**
 * APICenter Contracts Package
 * Public contracts, schemas, and contract interfaces for platform backends and SDK consumers.
 */

export const PUBLIC_CONTRACT_VERSION = '1.0';
export const OPENAPI_VERSION = '3.2.0';
export const ASYNCAPI_VERSION = '3.1.0';

// ---------------------------------------------------------------------------
// 1. Shared Service Platform Core Contracts
// ---------------------------------------------------------------------------

export type SharedServiceId = 'payments' | 'email' | 'sms' | 'otp' | 'gauth' | 'geo';

export interface SharedServiceManifest {
  serviceId: SharedServiceId | string;
  serviceName: string;
  serviceType: 'shared';
  ownerTribeId: string;
  version: string;
  baseUrl: string;
  capabilities: string[];
}

// ---------------------------------------------------------------------------
// 2. Payments Shared Service Contracts
// ---------------------------------------------------------------------------

export type PaymentEnvironment = 'test' | 'live';

export interface PaymentRecord {
  type: string;
  id: string;
  projectId: string;
  environment: PaymentEnvironment;
  referenceId: string | null;
  amountMinor: string | null;
  currency: string | null;
  status: string | null;
  createdAt: string;
  relatedResourceId: string | null;
}

export interface PaymentRecordPage { records: PaymentRecord[]; nextCursor?: string; }

export type CheckoutStatus =
  | 'draft'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'cancelled'
  | 'incomplete'
  | 'expired';

export type RefundStatus = 'pending' | 'succeeded' | 'failed';

export interface PaymentEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  contractVersion: typeof PUBLIC_CONTRACT_VERSION;
  eventType: string;
  ownerTribeId: string;
  consumerServiceId: string;
  referenceId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  data: T & {
    environment: PaymentEnvironment;
    aggregateVersion: number;
  };
}

export interface CheckoutSnapshot {
  checkoutId: string;
  referenceId: string;
  status: CheckoutStatus;
  amount: number;
  currency: 'PHP';
  aggregateVersion: number;
  customerEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentIntentSnapshot {
  paymentIntentId: string;
  referenceId: string;
  status: PaymentIntentStatus;
  amount: number;
  currency: 'PHP';
  aggregateVersion: number;
  clientSecret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionSnapshot {
  subscriptionId: string;
  referenceId: string;
  planId: string;
  status: SubscriptionStatus;
  aggregateVersion: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 3. Email Shared Service Contracts
// ---------------------------------------------------------------------------

export interface EmailSendRequest {
  from?: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

export interface EmailSendResponse {
  messageId: string;
  provider: string;
  status: string;
  recipient: string[];
  recipientCount: number;
  sentAt: string;
}

export interface EmailDeliveryStatus extends EmailSendResponse {
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 4. SMS Shared Service Contracts
// ---------------------------------------------------------------------------

export interface SmsSendRequest {
  to: string;
  message: string;
  senderId?: string;
}

export interface SmsSendResponse {
  messageId: string;
  status: string;
  to: string;
  recipient?: string;
  sentAt: string;
}

export interface SmsDeliveryStatus {
  messageId: string;
  to: string;
  message: string;
  status: string;
  senderId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 5. OTP Shared Service Contracts
// ---------------------------------------------------------------------------

export interface OtpGenerateRequest {
  channel: 'email' | 'sms';
  recipient: string;
  purpose?: 'login' | 'transaction' | 'verification';
  target?: string;
  ttlSeconds?: number;
  digits?: number;
}

export interface OtpGenerateResponse {
  otpId: string;
  expiresAt: string;
  channel: 'email' | 'sms';
  recipient: string;
  target: string;
  /** Returned only when the OTP runtime is configured for mock delivery. */
  code?: string;
}

export interface OtpVerifyRequest {
  otpId: string;
  code: string;
  recipient?: string;
}

export interface OtpVerifyResponse {
  verified: boolean;
  otpId: string;
  target?: string;
  channel?: 'sms' | 'email';
  reason?: string;
}

export interface OtpStatusResponse {
  otpId: string;
  status: string;
  target: string;
  channel: 'sms' | 'email';
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// 6. Google Auth (GAuth) Shared Service Contracts
// ---------------------------------------------------------------------------

export interface GauthVerifyTokenRequest {
  idToken: string;
}

export interface GauthVerifyTokenResponse {
  valid: boolean;
  userId?: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

export interface GauthUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export interface GoogleAuthorizationUrlRequest {
  scopes?: string[];
  state?: string;
  loginHint?: string;
  accessType?: 'online' | 'offline';
  includeGrantedScopes?: boolean;
  prompt?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'plain' | 'S256';
}

export interface GoogleAuthorizationUrlResponse {
  authorizationUrl: string;
  state: string;
  credentialSource?: string;
  expiresAt?: string;
}

export interface GoogleTokenExchangeRequest {
  code: string;
  codeVerifier?: string;
  state: string;
}

export interface GoogleTokenRefreshRequest {
  refreshToken: string;
}

export interface GoogleOAuthTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  idToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

export interface GoogleLogoutRequest {
  token?: string;
  refreshToken?: string;
  idTokenHint?: string;
}

export interface GoogleLogoutResponse {
  success: true;
}

// ---------------------------------------------------------------------------
// 7. Geolocation (Geo) Shared Service Contracts
// ---------------------------------------------------------------------------

export interface GeoIpLookupRequest {
  ipAddress: string;
}

export interface GeoIpLookupResponse {
  ipAddress: string;
  country: string;
  countryCode: string;
  city?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  isp?: string;
}

export interface GeocodeRequest {
  address: string;
}

export interface GeocodeResponse {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

export interface GeoGeocodeRequest extends GeocodeRequest {
  language?: string;
  region?: string;
}

export interface GeoReverseGeocodeRequest {
  latitude: number;
  longitude: number;
  language?: string;
  resultType?: string;
  locationType?: string;
}

export interface GeoAddressResult extends GeocodeResponse {
  types: string[];
  provider: 'mock' | 'google-maps';
  raw: unknown | null;
}

export interface GeoFenceInput {
  fenceId: string;
  name?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface GeoFenceCheckRequest {
  latitude: number;
  longitude: number;
  fenceId?: string;
  fences?: GeoFenceInput[];
}

export interface GeoFenceCheckResponse {
  inside: boolean;
  distanceDetails: Array<{
    fenceId: string;
    name?: string;
    inside: boolean;
    distanceMeters: number;
    radiusMeters: number;
  }>;
  provider: 'local';
}

// ---------------------------------------------------------------------------
// 8. Public Payment Facade Contracts
// ---------------------------------------------------------------------------

export interface Money {
  amountMinor: number;
  currency: 'PHP';
}

export interface CreateCheckoutInput {
  referenceId: string;
  amount: Money;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface Checkout {
  checkoutId: string;
  referenceId: string;
  status: CheckoutStatus | string;
  amount: Money;
  checkoutUrl?: string;
  aggregateVersion?: number;
}

export interface CreatePaymentIntentInput {
  referenceId: string;
  amount: Money;
}

export interface CreateQrPhPaymentIntentInput extends CreatePaymentIntentInput {
  description?: string;
  expirySeconds?: number;
}

export interface PaymentIntent {
  paymentIntentId: string;
  referenceId: string;
  status: PaymentIntentStatus | string;
  amount: Money;
  aggregateVersion?: number;
}

export interface QrPhPaymentIntent extends PaymentIntent {
  qrCodeImageUrl: string;
  expirySeconds: number;
}

export type ConfirmPaymentIntentInput = Record<string, never>;

export interface CreateCustomerInput {
  customerReference: string;
  email: string;
  name?: string;
}

export interface Customer {
  customerId: string;
  customerReference: string;
  email?: string;
  name?: string;
}

export interface CreatePlanInput {
  name: string;
  description?: string;
  amount: number;
  currency?: 'PHP';
  interval: 'weekly' | 'monthly' | 'yearly';
  intervalCount?: number;
  cycleCount?: number;
  metadata?: Record<string, string>;
}

export interface Plan {
  planId: string;
  name: string;
  description?: string;
  amount: number;
  currency: 'PHP';
  interval: 'weekly' | 'monthly' | 'yearly';
  intervalCount: number;
  cycleCount?: number;
  metadata?: Record<string, string>;
}

export interface CreatePaymentLinkInput {
  referenceId: string;
  amount: Money;
  description: string;
  remarks?: string;
  metadata?: Record<string, string>;
}

export interface PaymentLink {
  paymentLinkId: string;
  referenceId: string;
  amount: Money;
  description?: string;
  url?: string;
  status: string;
  active?: boolean;
  archived?: boolean;
  referenceNumber?: string;
  metadata?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateRefundInput {
  paymentId: string;
  amount: Money;
  reason?: string;
}

export interface Refund {
  refundId: string;
  paymentId: string;
  status: RefundStatus | string;
  amount: Money;
}

export interface CreateSubscriptionInput {
  customerId: string;
  referenceId: string;
  planId: string;
}

export interface Subscription {
  subscriptionId: string;
  customerId: string;
  planId?: string;
  status: SubscriptionStatus | string;
  currentPeriodEnd?: string;
}

export interface Invoice {
  invoiceId: string;
  status: string;
  amount: Money;
}

export interface PendingResource {
  status: 'pending';
  resourceId: string;
}

export type PaymentResource<T> = T | PendingResource;

export interface PaymentCapabilities {
  currency: 'PHP';
  paymentMethods: string[];
  resources: string[];
}

export interface ListPaymentRecordsOptions {
  type?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  cursor?: string;
}
