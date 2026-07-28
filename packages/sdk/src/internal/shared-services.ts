import type {
  ApiErrorDetails,
  EmailSendRequest,
  EmailSendResponse,
  GeoAddressResult,
  GeoFenceCheckRequest,
  GeoFenceCheckResponse,
  GeoGeocodeAddressRequest,
  GeoReverseGeocodeRequest,
  GoogleAuthorizationUrlRequest,
  GoogleAuthorizationUrlResponse,
  GoogleLogoutRequest,
  GoogleLogoutResponse,
  GoogleOAuthTokenResponse,
  GoogleTokenExchangeRequest,
  GoogleTokenRefreshRequest,
  OtpGenerateRequest,
  OtpGenerateResponse,
  OtpStatusResponse,
  OtpVerifyRequest,
  OtpVerifyResponse,
  SharedMessageStatus,
  SharedServiceRequestOptions,
  SmsSendRequest,
  SmsSendResponse,
  TribeClientOptions,
} from '../types';
import { ApiCenterError } from './payment';

type ApiEnvelope<T> = { success: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } };

type Method = 'GET' | 'POST';

export class SharedServicesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tribeId: string;
  private readonly environment: 'test' | 'live';
  private readonly fetchImpl: typeof fetch;

  constructor(options: TribeClientOptions) {
    if (!options.baseUrl.trim() || !options.apiKey.trim() || !options.tribeId.trim()) {
      throw new TypeError('baseUrl, apiKey, and tribeId are required');
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.tribeId = options.tribeId;
    this.environment = options.environment ?? 'test';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  emailSend(input: EmailSendRequest, options?: SharedServiceRequestOptions): Promise<EmailSendResponse> { return this.mutate('email', '/send', input, options); }
  emailGetStatus(messageId: string, options?: SharedServiceRequestOptions): Promise<SharedMessageStatus> { return this.read('email', `/status/${encodeURIComponent(messageId)}`, options); }
  smsSend(input: SmsSendRequest, options?: SharedServiceRequestOptions): Promise<SmsSendResponse> { return this.mutate('sms', '/send', input, options); }
  smsGetStatus(messageId: string, options?: SharedServiceRequestOptions): Promise<SharedMessageStatus> { return this.read('sms', `/status/${encodeURIComponent(messageId)}`, options); }
  gauthGetAuthorizationUrl(input: GoogleAuthorizationUrlRequest, options?: SharedServiceRequestOptions): Promise<GoogleAuthorizationUrlResponse> { return this.mutate('gauth', '/oauth/authorize', input, options); }
  gauthExchangeCode(input: GoogleTokenExchangeRequest, options?: SharedServiceRequestOptions): Promise<GoogleOAuthTokenResponse> { return this.mutate('gauth', '/oauth/token', input, options); }
  gauthRefreshToken(input: GoogleTokenRefreshRequest, options?: SharedServiceRequestOptions): Promise<GoogleOAuthTokenResponse> { return this.mutate('gauth', '/oauth/token/refresh', input, options); }
  gauthLogout(input: GoogleLogoutRequest, options?: SharedServiceRequestOptions): Promise<GoogleLogoutResponse> { return this.mutate('gauth', '/oauth/logout', input, options); }
  otpGenerate(input: OtpGenerateRequest, options?: SharedServiceRequestOptions): Promise<OtpGenerateResponse> { return this.mutate('otp', '/generate', input, options); }
  otpVerify(input: OtpVerifyRequest, options?: SharedServiceRequestOptions): Promise<OtpVerifyResponse> { return this.mutate('otp', '/verify', input, options); }
  otpStatus(otpId: string, options?: SharedServiceRequestOptions): Promise<OtpStatusResponse> { return this.read('otp', `/status/${encodeURIComponent(otpId)}`, options); }
  geoGeocodeAddress(input: GeoGeocodeAddressRequest, options?: SharedServiceRequestOptions): Promise<GeoAddressResult> { return this.mutate('geo', '/geocode', input, options); }
  geoReverseGeocode(input: GeoReverseGeocodeRequest, options?: SharedServiceRequestOptions): Promise<GeoAddressResult> { return this.mutate('geo', '/reverse-geocode', input, options); }
  geoFenceCheck(input: GeoFenceCheckRequest, options?: SharedServiceRequestOptions): Promise<GeoFenceCheckResponse> { return this.mutate('geo', '/geofence/check', input, options); }

  private read<T>(serviceId: string, path: string, options?: SharedServiceRequestOptions): Promise<T> { return this.request(serviceId, path, 'GET', undefined, options); }
  private mutate<T>(serviceId: string, path: string, body: unknown, options?: SharedServiceRequestOptions): Promise<T> { return this.request(serviceId, path, 'POST', body, options); }

  private async request<T>(serviceId: string, path: string, method: Method, body?: unknown, options?: SharedServiceRequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'X-Tribe-ID': this.tribeId,
      'X-APICenter-Environment': this.environment,
      ...(options?.headers ?? {}),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/shared/${encodeURIComponent(serviceId)}${path}`, {
      method,
      headers,
      signal: options?.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: ApiEnvelope<T>;
    try { payload = (await response.json()) as ApiEnvelope<T>; }
    catch { throw new ApiCenterError(`APICenter shared service returned invalid JSON (${response.status})`, { status: response.status }); }
    if (response.ok && payload.success === true && payload.data !== undefined) return payload.data;
    const details: ApiErrorDetails = { code: payload.error?.code, message: payload.error?.message, details: payload.error?.details, status: response.status };
    throw new ApiCenterError(details.message ?? `APICenter shared service request failed (${response.status})`, details);
  }
}