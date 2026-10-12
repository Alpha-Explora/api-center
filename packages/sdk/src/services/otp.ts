import type { OtpGenerateRequest, OtpGenerateResponse, OtpStatusResponse, OtpVerifyRequest, OtpVerifyResponse } from '@alpha-explora/apicenter-contracts';
import type { IdempotencyOptions, RequestOptions } from '../types';
import { ApiCenterTransport } from '../internal/transport';

export class OtpClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation otp.generate POST /api/v1/shared/otp/generate */
  generate(input: OtpGenerateRequest, options: IdempotencyOptions): Promise<OtpGenerateResponse> {
    return this.transport.request({
      path: '/api/v1/shared/otp/generate',
      method: 'POST',
      credential: 'service',
      body: input,
      idempotencyKey: options.idempotencyKey,
      options,
    });
  }

  /** @sdk-operation otp.verify POST /api/v1/shared/otp/verify */
  verify(input: OtpVerifyRequest, options: IdempotencyOptions): Promise<OtpVerifyResponse> {
    return this.transport.request({
      path: '/api/v1/shared/otp/verify',
      method: 'POST',
      credential: 'service',
      body: input,
      idempotencyKey: options.idempotencyKey,
      options,
    });
  }

  /** @sdk-operation otp.getStatus GET /api/v1/shared/otp/status/{otpId} */
  getStatus(otpId: string, options?: RequestOptions): Promise<OtpStatusResponse> {
    return this.transport.request({
      path: `/api/v1/shared/otp/status/${encodeURIComponent(otpId)}`,
      method: 'GET',
      credential: 'service',
      options,
    });
  }
}
