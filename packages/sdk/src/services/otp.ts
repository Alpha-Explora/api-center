import type { OtpGenerateRequest, OtpGenerateResponse, OtpStatusResponse, OtpVerifyRequest, OtpVerifyResponse } from '@alpha-explora/apicenter-contracts';
import type { ApiCenterTransport } from '../internal/transport.js';
import type { RequestOptions, WriteOptions } from '../types.js';

export class OtpClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** Sends a one-time code by email or SMS. @sdk-operation otp.send POST /api/v1/shared/otp/generate */
  send(input: OtpGenerateRequest, options?: WriteOptions): Promise<OtpGenerateResponse> {
    return this.transport.request({ path: '/api/v1/shared/otp/generate', method: 'POST', body: input, write: true, idempotencyKey: options?.idempotencyKey, options });
  }

  /** @sdk-operation otp.verify POST /api/v1/shared/otp/verify */
  verify(input: OtpVerifyRequest, options?: WriteOptions): Promise<OtpVerifyResponse> {
    return this.transport.request({ path: '/api/v1/shared/otp/verify', method: 'POST', body: input, write: true, idempotencyKey: options?.idempotencyKey, options });
  }

  /** @sdk-operation otp.get GET /api/v1/shared/otp/status/{otpId} */
  get(otpId: string, options?: RequestOptions): Promise<OtpStatusResponse> {
    return this.transport.request({ path: `/api/v1/shared/otp/status/${encodeURIComponent(otpId)}`, method: 'GET', options });
  }
}
