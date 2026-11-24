import type { SharedServiceCaller } from '@apicenter/runtime';
import type { SmsRecord } from './sms-store';
import type { ProjectSmsSender } from './project-sender';

/** Every lookup takes the caller that created the record, so one owner never reads another owner's record. */
export interface SmsRepositoryInterface {
  /** `sent` (the provider and its message ID) is stored on first save, never returned, and matched by delivery events. */
  save(record: SmsRecord, owner: SharedServiceCaller, sent?: ProviderMessage): Promise<SmsRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null>;
  applyDeliveryEvent(event: SmsDeliveryEvent): Promise<{ duplicate: boolean }>;
  getProjectSender(projectId: string, environment: ProjectSmsSender['environment']): Promise<ProjectSmsSender | null>;
  /** Upserts the project's sender; a null senderId clears it (the runtime role cannot delete rows). */
  setProjectSender(sender: ProjectSmsSender): Promise<ProjectSmsSender>;
}

/** A message as the SMS provider knows it. */
export interface ProviderMessage {
  provider: string;
  id: string;
}

export interface SmsDeliveryEvent {
  providerEventId: string;
  /** The SMS provider that reported the event. */
  provider: string;
  /** The SMS provider's message ID; the store resolves it to APICenter's. */
  providerMessageId: string;
  status: 'accepted' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'read' | 'canceled';
  payload: unknown;
}
