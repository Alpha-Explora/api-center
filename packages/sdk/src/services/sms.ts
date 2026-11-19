import type { SmsDeliveryStatus, SmsSendRequest, SmsSendResponse } from '@alpha-explora/apicenter-contracts';
import type { ApiCenterTransport } from '../internal/transport.js';
import type { RequestOptions, WriteOptions } from '../types.js';

export class SmsClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation sms.send POST /api/v1/shared/sms/send */
  send(input: SmsSendRequest, options?: WriteOptions): Promise<SmsSendResponse> {
    return this.transport.request({ path: '/api/v1/shared/sms/send', method: 'POST', body: input, write: true, idempotencyKey: options?.idempotencyKey, options });
  }

  /** @sdk-operation sms.get GET /api/v1/shared/sms/status/{messageId} */
  get(messageId: string, options?: RequestOptions): Promise<SmsDeliveryStatus> {
    return this.transport.request({ path: `/api/v1/shared/sms/status/${encodeURIComponent(messageId)}`, method: 'GET', options });
  }
}
