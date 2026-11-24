import type { SharedServiceCaller } from '@apicenter/runtime';
import type { SmsRecord } from './sms-store';
import type { ProjectSmsSender } from './project-sender';

/** Every lookup takes the caller that created the record, so one owner never reads another owner's record. */
export interface SmsRepositoryInterface {
  /** `providerMessageId` is stored on first save, never returned, and matched by delivery events. */
  save(record: SmsRecord, owner: SharedServiceCaller, providerMessageId?: string): Promise<SmsRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null>;
  applyDeliveryEvent(event: SmsDeliveryEvent): Promise<{ duplicate: boolean }>;
  getProjectSender(projectId: string, environment: ProjectSmsSender['environment']): Promise<ProjectSmsSender | null>;
  /** Upserts the project's sender; a null senderId clears it (the runtime role cannot delete rows). */
  setProjectSender(sender: ProjectSmsSender): Promise<ProjectSmsSender>;
}

export interface SmsDeliveryEvent {
  providerEventId: string;
  /** The SMS provider's message ID; the store resolves it to APICenter's. */
  providerMessageId: string;
  status: 'accepted' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'read' | 'canceled';
  payload: unknown;
}
