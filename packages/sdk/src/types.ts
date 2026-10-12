import type { PaymentEnvironment } from '@apicenter/contracts';

export type { PaymentEnvironment };
export type {
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
} from '@apicenter/contracts';

export interface ServiceCredentials {
  serviceId: string;
  environment: PaymentEnvironment;
  secret: string;
}

export interface AccessTokenProvider {
  getAccessToken: () => Promise<string>;
}

export type ApiCenterAuth = ServiceCredentials | AccessTokenProvider;

export interface ApiCenterOptions {
  baseUrl: string;
  /** Omit only when configuring a payment API key for payment-only use. */
  auth?: ApiCenterAuth;
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
