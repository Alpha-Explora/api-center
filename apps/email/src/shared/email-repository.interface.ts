import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailRecord } from './email-store';

/** Every lookup takes the caller that created the message, so one owner never reads another owner's record. */
export interface EmailRepositoryInterface {
  save(record: EmailRecord, owner: SharedServiceCaller): Promise<EmailRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null>;
  setProjectSender(sender: ProjectEmailSender): Promise<ProjectEmailSender>;
  /**
   * Reserves a 'pending' message under the project lock, then calls `send` after the lock is released.
   * `send` returns the provider's message ID, or undefined to keep the local ID. The message is then
   * stored as 'queued', or as 'failed' when `send` throws. Failed messages do not count toward the limit.
   */
  sendWithinDailyLimit(
    owner: SharedServiceCaller,
    message: EmailSendReservation,
    send: (fromAddress: string) => Promise<string | undefined>,
  ): Promise<EmailRecord>;
  applyDeliveryEvent(event: EmailDeliveryEvent): Promise<{ duplicate: boolean }>;
}

/** The message to reserve and the defaults used when the project has no sender configuration. */
export interface EmailSendReservation {
  requestedFrom: string | undefined;
  defaultFrom: string;
  defaultDailyLimit: number;
  provider: string;
  recipients: string[];
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
