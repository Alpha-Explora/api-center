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
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  tags?: Record<string, string>;
}

export interface EmailSendResponse {
  messageId: string;
  status: 'queued' | 'sent' | 'failed';
  recipientCount: number;
  sentAt: string;
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
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  to: string;
  sentAt: string;
}

export interface SmsDeliveryStatus {
  messageId: string;
  status: 'delivered' | 'failed' | 'pending';
  deliveredAt?: string;
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// 5. OTP Shared Service Contracts
// ---------------------------------------------------------------------------

export interface OtpGenerateRequest {
  channel: 'email' | 'sms';
  recipient: string;
  purpose: 'login' | 'transaction' | 'verification';
  ttlSeconds?: number;
  digits?: number;
}

export interface OtpGenerateResponse {
  otpId: string;
  expiresAt: string;
  channel: 'email' | 'sms';
  recipient: string;
}

export interface OtpVerifyRequest {
  otpId: string;
  code: string;
  recipient: string;
}

export interface OtpVerifyResponse {
  verified: boolean;
  otpId: string;
  reason?: string;
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
