import type { SmsDeliveryStatus, SmsSendRequest, SmsSendResponse } from '@apicenter/contracts';
import type { IdempotencyOptions, RequestOptions } from '../types';
import { ApiCenterTransport } from '../internal/transport';

export class SmsClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation sms.send POST /api/v1/shared/sms/send */
  send(input: SmsSendRequest, options: IdempotencyOptions): Promise<SmsSendResponse> {
    return this.transport.request({
      path: '/api/v1/shared/sms/send',
      method: 'POST',
      credential: 'service',
      body: input,
      idempotencyKey: options.idempotencyKey,
      options,
    });
  }

  /** @sdk-operation sms.getStatus GET /api/v1/shared/sms/status/{messageId} */
  getStatus(messageId: string, options?: RequestOptions): Promise<SmsDeliveryStatus> {
    return this.transport.request({
      path: `/api/v1/shared/sms/status/${encodeURIComponent(messageId)}`,
      method: 'GET',
      credential: 'service',
      options,
    });
  }
}
