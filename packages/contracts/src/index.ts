/**
 * APICenter Contracts Package
 * Public contracts, schemas, and contract interfaces for platform backends and SDK consumers.
 */

export const PUBLIC_CONTRACT_VERSION = '1.0';
/** The payment event contract version every event carries. */
export const PAYMENT_EVENT_CONTRACT_VERSION = '2.0';
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

export type ProjectSetupStatus = 'ready' | 'missing' | 'unknown';

export interface ProjectSetupCheck {
  id: string;
  status: ProjectSetupStatus;
  detail: string;
  fix: string;
}

export interface ProjectSetupStatusResponse {
  projectId: string;
  serviceId: string;
  environment: PaymentEnvironment;
  checks: ProjectSetupCheck[];
}

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

export type RefundStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

/** Payment event contract 2.0: who the resource belongs to, which change this is, and its data. */
export interface PaymentEventEnvelope<T = Record<string, unknown>> {
  eventId: string;
  contractVersion: typeof PAYMENT_EVENT_CONTRACT_VERSION;
  eventType: string;
  environment: PaymentEnvironment;
  organizationId: string;
  projectId: string;
  /** The application whose call created the resource. */
  applicationId: string;
  referenceId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId?: string;
  data: T;
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
  redirectUri?: string;
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
  redirectUri?: string;
  code: string;
  codeVerifier?: string;
  state: string;
}

export interface GoogleTokenRefreshRequest {
  redirectUri?: string;
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
  /** @deprecated The geocoding provider's place identifier. Returned until 2027-03-01. */
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
  /** @deprecated A geocoding-provider result filter. Honoured until 2027-03-01, then ignored. */
  resultType?: string;
  /** @deprecated A geocoding-provider precision filter. Honoured until 2027-03-01, then ignored. */
  locationType?: string;
}

/** The parts of a Philippine address. A part the source does not know is omitted. */
export interface GeoAddressComponents {
  streetNumber?: string;
  street?: string;
  barangay?: string;
  /** City or municipality. */
  city?: string;
  province?: string;
  region?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
}

export interface GeoAddressResult extends GeocodeResponse {
  components: GeoAddressComponents;
  /** How exactly the coordinates locate the address: exact, street, area or approximate. An open set. */
  precision: 'exact' | 'street' | 'area' | 'approximate' | (string & {});
  /** @deprecated The geocoding provider's result types. Returned until 2027-03-01; use precision. */
  types: string[];
  /** @deprecated Which geocoding source answered. Returned until 2027-03-01. */
  provider: string;
  /** @deprecated The geocoding provider's unprocessed result. Returned until 2027-03-01; use components. */
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

/** A way to pay. GET /payments/capabilities lists the ones enabled for your environment. */
export type PaymentMethod = 'card' | 'gcash' | 'paymaya' | 'qrph';

/** A wallet a payment intent can open directly. */
export type WalletPaymentMethod = 'gcash' | 'paymaya';

export interface CreateCheckoutInput {
  referenceId: string;
  amount: Money;
  /** An HTTPS link, or your app's own link such as `myapp://booking/123`. See {@link CreateWalletPaymentIntentInput.returnUrl}. */
  successUrl: string;
  cancelUrl: string;
  /** Limits the checkout page to these methods. Leave it out to offer card, GCash and Maya. */
  paymentMethods?: PaymentMethod[];
  metadata?: Record<string, string>;
  /** Payee shares of the payment: held when it is paid, paid out after you release them. */
  allocations?: AllocationInput[];
}

export interface Checkout {
  checkoutId: string;
  referenceId: string;
  status: CheckoutStatus | string;
  amount: Money;
  checkoutUrl?: string;
  aggregateVersion?: number;
  /** Present on the create response when the request had allocations. */
  allocations?: Allocation[];
}

export interface CreatePaymentIntentInput {
  referenceId: string;
  amount: Money;
  /** Payee shares of the payment: held when it is paid, paid out after you release them. */
  allocations?: AllocationInput[];
}

/** Customer details a wallet payment can carry. */
export interface PaymentBilling {
  name?: string;
  email?: string;
  phone?: string;
}

/** A payment intent that opens one wallet directly. Send the customer to its `nextAction.redirectUrl`. */
export interface CreateWalletPaymentIntentInput extends CreatePaymentIntentInput {
  paymentMethod: WalletPaymentMethod;
  /**
   * Where the wallet sends the customer afterwards, paid or not. An HTTPS link, or your app's own link
   * such as `myapp://booking/123`; APICenter forwards to an app link from an HTTPS page it hosts.
   */
  returnUrl: string;
  description?: string;
  billing?: PaymentBilling;
}

export interface CreateQrPhPaymentIntentInput extends Omit<CreatePaymentIntentInput, 'allocations'> {
  description?: string;
  expirySeconds?: number;
}

export interface PaymentIntent {
  paymentIntentId: string;
  referenceId: string;
  status: PaymentIntentStatus | string;
  amount: Money;
  aggregateVersion?: number;
  clientKey?: string;
  nextAction?: PaymentIntentNextAction;
  /** Set on a wallet payment intent. */
  paymentMethod?: WalletPaymentMethod;
  /** Present on the create response when the request had allocations. */
  allocations?: Allocation[];
  /** Why the last payment attempt failed, when status is `failed`. */
  lastPaymentError?: PaymentError;
}

export interface PaymentError {
  code?: string;
  message?: string;
}

/** A provider action the customer must complete to advance a payment intent. */
export interface PaymentIntentNextAction {
  type: 'redirect';
  redirectUrl: string;
  returnUrl?: string;
}

export interface QrPhPaymentIntent extends PaymentIntent {
  qrCodeImageUrl: string;
  expirySeconds: number;
}

/** Client-created payment method and redirect context used to confirm an intent. */
export interface ConfirmPaymentIntentInput {
  paymentMethodId: string;
  clientKey: string;
  returnUrl: string;
}

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
  /** Payee shares of every payment made through the link. */
  allocations?: AllocationInput[];
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
  /** Present on the create response when the request had allocations. */
  allocations?: Allocation[];
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
  /** The methods enabled for your environment. Hide any method that is not listed. */
  paymentMethods: PaymentMethod[];
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

// Payouts: a project pays the people who deliver its service (payees) out of its payments.

/** A payee's share of a payment. The shares of one payment may not add up to more than the payment. */
export interface AllocationInput {
  payeeId: string;
  amount: Money;
}

export type AllocationStatus = 'awaiting_payment' | 'held' | 'released' | 'pooled' | 'paid' | 'cancelled';

export interface Allocation {
  allocationId: string;
  payeeId: string;
  amount: Money;
  /** awaiting_payment until the payment is confirmed, then held until you release it. */
  status: AllocationStatus;
  paymentId: string | null;
}

export interface CreatePayeeInput {
  /** Your own identifier for the payee; payout events carry it as referenceId. Creating the same one again returns the existing payee. */
  externalRef: string;
  /** The name on the payee's account. A mismatch is the most common reason a transfer fails. */
  legalName: string;
}

/** Where a payee is paid: a GCash or bank account through InstaPay, or a wallet at APICenter's payment provider. */
export type PayoutDestination =
  | { type: 'instapay'; /** For example GXCHPHM2XXX for GCash. */ bic: string; accountNumber: string; accountName: string }
  | { type: 'provider_wallet'; accountNumber: string; accountName: string };

/** A payee's destination as APICenter returns it: the account number is masked. */
export interface PayeeDestination {
  type: 'instapay' | 'provider_wallet';
  bic?: string;
  accountName: string;
  accountNumberLast4: string;
}

export interface RecordPayeeVerificationInput {
  verifiedBy: string;
  verifiedAt: string;
  method: 'government_id' | 'in_person' | 'third_party' | 'other';
  /** Reference to the project's verification record. Never use an identity document number. */
  reference?: string | null;
}

export type PayeeVerification = RecordPayeeVerificationInput & { reference: string | null };

export interface PayeeOnboardingInput {
  firstName: string;
  lastName: string;
  email: string;
}

export type PayeeOnboardingStatus = 'draft' | 'created' | 'details_submitted' | 'verification_pending'
  | 'verification_failed' | 'manual_review' | 'activation_pending' | 'active' | 'declined';

export interface PayeeOnboarding {
  onboardingId: string;
  status: PayeeOnboardingStatus;
  nextAction: 'create' | 'submit_details' | 'issue_verification_link' | 'await_verification' | 'reissue_verification_link'
    | 'activate' | 'await_activation' | 'await_manual_review' | 'none';
  attempts: number;
  walletOnly: boolean;
  declineReason: string | null;
  /** Available only when the API issues a fresh link. */
  verification: { url: string; expiresAt: string } | null;
}

export interface Payee {
  payeeId: string;
  externalRef: string;
  legalName: string;
  status: 'active' | 'suspended';
  destination: PayeeDestination | null;
  /** Payouts to the payee wait until this time after a destination change. */
  destinationHoldUntil: string | null;
  verification: PayeeVerification | null;
  createdAt: string;
}

export interface PayeeEarnings {
  awaitingPayment: Money;
  held: Money;
  /** Released and not yet paid, after any refund clawbacks. */
  available: Money;
  inFlight: Money;
  paidThisWeek: Money;
}

export interface PayeeDetail extends Payee {
  earnings: PayeeEarnings;
}

export interface PayeePage {
  records: Payee[];
  nextCursor?: string;
}

export interface ListPayeesOptions {
  limit?: number;
  cursor?: string;
}

/** unknown and needs_review mean APICenter is confirming the transfer with the provider; it is never sent twice. */
export type PayoutStatus = 'draft' | 'submitting' | 'pending' | 'unknown' | 'paid' | 'failed' | 'needs_review';
export type PayoutTrigger = 'schedule' | 'release' | 'cash_out';

/** One transfer of a payee's pooled earnings. */
export interface Payout {
  payoutId: string;
  payeeId: string;
  status: PayoutStatus;
  trigger: PayoutTrigger;
  gross: Money;
  /** The transfer fee. It comes out of net only when the payee bears it. */
  fee: { amountMinor: number; currency: 'PHP' };
  net: Money;
  failureCode: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CashOutPayout extends Payout {
  /** Additional transfers for the same cash-out when released earnings span accounts. */
  additionalPayouts?: Payout[];
}

export interface PayoutPage {
  records: Payout[];
  nextCursor?: string;
}

export interface ListPayoutsOptions {
  payeeId?: string;
  status?: PayoutStatus;
  limit?: number;
  cursor?: string;
}
