export type {
  CashOutPayout,
  PayeeVerification,
  RecordPayeeVerificationInput,
  Checkout,
  ConfirmPaymentIntentInput,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePaymentIntentInput,
  CreatePaymentLinkInput,
  CreatePlanInput,
  CreateQrPhPaymentIntentInput,
  CreateWalletPaymentIntentInput,
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
  PaymentBilling,
  PaymentCapabilities,
  PaymentError,
  PaymentIntent,
  PaymentLink,
  PaymentMethod,
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
  WalletPaymentMethod,
} from '@alpha-explora/apicenter-contracts';

/** Per-call settings. */
export interface RequestOptions {
  /** Extra headers; the SDK manages Authorization, Idempotency-Key and its own version headers. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Overrides the client's timeout for each attempt of this call, in milliseconds. */
  timeoutMs?: number;
}

/** Per-call settings for a write. */
export interface WriteOptions extends RequestOptions {
  /**
   * 16 to 255 characters. When omitted the SDK generates one per call and reuses it across its own
   * retries. Pass your own, stored with the business operation (for example the order), when a retry
   * after a crash or timeout must not repeat the write.
   */
  idempotencyKey?: string;
}

export interface RequestInfo {
  method: string;
  url: string;
  /** 1 for the first try, then 2, 3… for retries. */
  attempt: number;
  idempotencyKey?: string;
}

export interface ResponseInfo extends Omit<RequestInfo, 'idempotencyKey'> {
  /** 0 when APICenter could not be reached. */
  status: number;
  durationMs: number;
  requestId?: string;
  error?: Error;
}

/** Called around every attempt, for logging and tracing. Must not throw. */
export interface RequestHooks {
  onRequest?(info: RequestInfo): void;
  onResponse?(info: ResponseInfo): void;
}

export interface ApiCenterOptions {
  /** An application key. Defaults to the APICENTER_API_KEY environment variable. */
  apiKey?: string;
  /** Timeout for each attempt, in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Retries for network errors, timeouts, 408, 429 and 5xx. Default 2; 0 turns retries off. */
  maxRetries?: number;
  /** A fetch implementation, for tests or custom agents. Defaults to the global fetch. */
  fetch?: typeof fetch;
  hooks?: RequestHooks;
}
