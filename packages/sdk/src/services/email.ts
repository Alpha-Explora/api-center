import type { EmailDeliveryStatus, EmailSendRequest, EmailSendResponse } from '@alpha-explora/apicenter-contracts';
import type { IdempotencyOptions, RequestOptions } from '../types';
import { ApiCenterTransport } from '../internal/transport';

export class EmailClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation email.send POST /api/v1/shared/email/send */
  send(input: EmailSendRequest, options: IdempotencyOptions): Promise<EmailSendResponse> {
    return this.transport.request({
      path: '/api/v1/shared/email/send',
      method: 'POST',
      credential: 'service',
      body: input,
      idempotencyKey: options.idempotencyKey,
      options,
    });
  }

  /** @sdk-operation email.getStatus GET /api/v1/shared/email/status/{messageId} */
  getStatus(messageId: string, options?: RequestOptions): Promise<EmailDeliveryStatus> {
    return this.transport.request({
      path: `/api/v1/shared/email/status/${encodeURIComponent(messageId)}`,
      method: 'GET',
      credential: 'service',
      options,
    });
  }
}
