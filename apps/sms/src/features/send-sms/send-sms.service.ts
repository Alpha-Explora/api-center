import crypto from 'node:crypto';
import type { SmsSendRequest, SmsSendResponse } from '@apicenter/contracts';
import { SmsRecipient, SmsMessagePayload } from './send-sms.model';
import { createSmsRepository } from '../../shared/sms-store';
import type { SmsRepositoryInterface } from '../../shared/sms-repository.interface';
import { TwilioSmsProvider } from '../../shared/twilio-sms-provider';

export class SendSmsService {
  constructor(
    private readonly store: SmsRepositoryInterface = createSmsRepository(),
    private readonly provider = new TwilioSmsProvider(),
  ) {}

  async execute(input: SmsSendRequest & { senderId?: string }): Promise<SmsSendResponse & { recipient: string }> {
    const recipientVo = new SmsRecipient(input.to);
    const messageVo = new SmsMessagePayload(input.message);

    const delivery = process.env.SMS_PROVIDER_MODE === 'mock' && process.env.NODE_ENV !== 'production'
      ? { messageId: `mock_${crypto.randomUUID().replace(/-/g, '')}`, status: 'queued' as const }
      : await this.provider.send(recipientVo.getValue(), messageVo.getValue(), input.senderId);
    const sentAt = new Date().toISOString();

    const record = {
      messageId: delivery.messageId,
      to: recipientVo.getValue(),
      message: messageVo.getValue(),
      senderId: input.senderId,
      status: delivery.status,
      createdAt: sentAt,
    };

    await this.store.save(record);

    return {
      messageId: delivery.messageId,
      status: delivery.status,
      to: recipientVo.getValue(),
      sentAt,
      recipient: recipientVo.getValue(),
    };
  }
}
