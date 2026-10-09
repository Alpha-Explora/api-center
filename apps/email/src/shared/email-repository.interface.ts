import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailRecord } from './email-store';

/** Every lookup takes the caller that created the message, so one owner never reads another owner's record. */
export interface EmailRepositoryInterface {
  save(record: EmailRecord, owner: SharedServiceCaller): Promise<EmailRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null>;
  setProjectSender(sender: ProjectEmailSender): Promise<ProjectEmailSender>;
  sendWithinDailyLimit(
    owner: SharedServiceCaller,
    requestedFrom: string | undefined,
    defaultFrom: string,
    defaultDailyLimit: number,
    send: (fromAddress: string) => Promise<EmailRecord>,
  ): Promise<EmailRecord>;
  applyDeliveryEvent(event: EmailDeliveryEvent): Promise<{ duplicate: boolean }>;
}

export interface ProjectEmailSender {
  projectId: string;
  environment: 'test' | 'live';
  fromAddress: string;
  dailyLimit: number | null;
}

export interface EmailDeliveryEvent {
  providerEventId: string;
  messageId: string;
  status: 'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained' | 'failed' | 'suppressed' | 'opened' | 'clicked';
  payload: unknown;
}
