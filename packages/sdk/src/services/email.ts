import type { EmailDeliveryStatus, EmailSendRequest, EmailSendResponse } from '@alpha-explora/apicenter-contracts';
import type { ApiCenterTransport } from '../internal/transport.js';
import type { RequestOptions, WriteOptions } from '../types.js';

export class EmailClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation email.send POST /api/v1/shared/email/send */
  send(input: EmailSendRequest, options?: WriteOptions): Promise<EmailSendResponse> {
    return this.transport.request({ path: '/api/v1/shared/email/send', method: 'POST', body: input, write: true, idempotencyKey: options?.idempotencyKey, options });
  }

  /** @sdk-operation email.get GET /api/v1/shared/email/status/{messageId} */
  get(messageId: string, options?: RequestOptions): Promise<EmailDeliveryStatus> {
    return this.transport.request({ path: `/api/v1/shared/email/status/${encodeURIComponent(messageId)}`, method: 'GET', options });
  }
}
