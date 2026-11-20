import type { SharedServiceCaller } from '@apicenter/runtime';
import type { SmsRecord } from './sms-store';
import type { ProjectSmsSender } from './project-sender';

/** Every lookup takes the caller that created the record, so one owner never reads another owner's record. */
export interface SmsRepositoryInterface {
  save(record: SmsRecord, owner: SharedServiceCaller): Promise<SmsRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null>;
  applyDeliveryEvent(event: SmsDeliveryEvent): Promise<{ duplicate: boolean }>;
  getProjectSender(projectId: string, environment: ProjectSmsSender['environment']): Promise<ProjectSmsSender | null>;
  /** Upserts the project's sender; a null senderId clears it (the runtime role cannot delete rows). */
  setProjectSender(sender: ProjectSmsSender): Promise<ProjectSmsSender>;
}

export interface SmsDeliveryEvent {
  providerEventId: string;
  messageId: string;
  status: 'accepted' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'read' | 'canceled';
  payload: unknown;
}
