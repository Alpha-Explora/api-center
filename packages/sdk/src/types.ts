import type { PaymentEnvironment } from '@alpha-explora/apicenter-contracts';

export type { PaymentEnvironment };
export type {
  ProjectSetupCheck,
  ProjectSetupStatus,
  ProjectSetupStatusResponse,
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
  EmailDeliveryStatus,
  EmailSendRequest,
  EmailSendResponse,
  GeoAddressResult,
  GeoFenceCheckRequest,
  GeoFenceCheckResponse,
  GeoGeocodeRequest,
  GeoReverseGeocodeRequest,
  GoogleAuthorizationUrlRequest,
  GoogleAuthorizationUrlResponse,
  GoogleLogoutRequest,
  GoogleLogoutResponse,
  GoogleOAuthTokenResponse,
  GoogleTokenExchangeRequest,
  GoogleTokenRefreshRequest,
  Invoice,
  ListPaymentRecordsOptions,
  Money,
  OtpGenerateRequest,
  OtpGenerateResponse,
  OtpStatusResponse,
  OtpVerifyRequest,
  OtpVerifyResponse,
  PaymentCapabilities,
  PaymentIntent,
  PaymentLink,
  PaymentRecord,
  PaymentRecordPage,
  PaymentResource,
  Plan,
  QrPhPaymentIntent,
  Refund,
  SmsDeliveryStatus,
  SmsSendRequest,
  SmsSendResponse,
  Subscription,
} from '@alpha-explora/apicenter-contracts';

/** An APICenter application key (`ak_test_…` or `ak_live_…`). Works for every operation it is granted. */
export interface ApplicationKey {
  apiKey: string;
}

/** @deprecated Legacy service credentials; use an application key (`{ apiKey }`). */
export interface ServiceCredentials {
  serviceId: string;
  environment: PaymentEnvironment;
  secret: string;
}

export interface AccessTokenProvider {
  getAccessToken: (options?: { signal?: AbortSignal }) => Promise<string>;
}

export type ApiCenterAuth = ApplicationKey | ServiceCredentials | AccessTokenProvider;

export interface ApiCenterOptions {
  /** Defaults to `APICENTER_URL`, then the hosted APICenter gateway. */
  baseUrl?: string;
  /** Defaults to the application key in `APICENTER_API_KEY`. */
  auth?: ApiCenterAuth;
  /** @deprecated Legacy payment key (`apic_…`). An application key with payments grants replaces it. */
  paymentApiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface IdempotencyOptions extends RequestOptions {
  idempotencyKey: string;
}
