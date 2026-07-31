import crypto from 'node:crypto';
import type { SmsSendRequest, SmsSendResponse } from '@apicenter/contracts';
import { SmsRecipient, SmsMessagePayload } from './send-sms.model';
import { MemorySmsStore } from '../../shared/sms-store';

export class SendSmsService {
  constructor(private readonly store = MemorySmsStore.getInstance()) {}

  async execute(input: SmsSendRequest & { senderId?: string }): Promise<SmsSendResponse & { recipient: string }> {
    const recipientVo = new SmsRecipient(input.to);
    const messageVo = new SmsMessagePayload(input.message);

    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
    const sentAt = new Date().toISOString();

    const record = {
      messageId,
      to: recipientVo.getValue(),
      message: messageVo.getValue(),
      senderId: input.senderId,
      status: 'sent',
      createdAt: sentAt,
    };

    await this.store.save(record);

    return {
      messageId,
      status: 'sent',
      to: recipientVo.getValue(),
      sentAt,
      recipient: recipientVo.getValue(),
    };
  }
}
