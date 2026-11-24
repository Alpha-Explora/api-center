import crypto from 'node:crypto';
import { createSmsSender, mintId, type SmsSender } from '@apicenter/runtime';
import type { SmsSendRequest, SmsSendResponse } from '@alpha-explora/apicenter-contracts';
import type { SharedServiceCaller } from '@apicenter/runtime';
import { SmsRecipient, SmsMessagePayload } from './send-sms.model';
import { createSmsRepository } from '../../shared/sms-store';
import type { SmsRepositoryInterface } from '../../shared/sms-repository.interface';

export class SendSmsService {
  constructor(
    private readonly store: SmsRepositoryInterface = createSmsRepository(),
    private readonly sender: SmsSender = createSmsSender(),
  ) {}

  async execute(input: SmsSendRequest & { senderId?: string }, owner: SharedServiceCaller): Promise<SmsSendResponse & { recipient: string }> {
    const recipientVo = new SmsRecipient(input.to);
    const messageVo = new SmsMessagePayload(input.message);

    const mock = owner.suppressDelivery || (process.env.SMS_PROVIDER_MODE === 'mock' && process.env.NODE_ENV !== 'production');
    const delivery = mock
      ? { providerMessageId: `mock_${crypto.randomUUID().replace(/-/g, '')}`, status: 'queued' as const }
      : await this.sender.send({ to: recipientVo.getValue(), message: messageVo.getValue(), senderId: input.senderId });
    const sentAt = new Date().toISOString();

    // APICenter mints the public ID; the provider's ID is stored beside it and never returned (ADR-0010).
    const messageId = mintId('sms');
    const record = {
      messageId,
      to: recipientVo.getValue(),
      message: messageVo.getValue(),
      senderId: input.senderId,
      status: delivery.status,
      createdAt: sentAt,
    };

    // Only a message the provider accepted has a provider ID; a suppressed or mock send has none.
    if (mock) await this.store.save(record, owner);
    else await this.store.save(record, owner, { provider: this.sender.provider, id: delivery.providerMessageId });

    return {
      messageId,
      status: delivery.status,
      to: recipientVo.getValue(),
      sentAt,
      recipient: recipientVo.getValue(),
    };
  }
}
