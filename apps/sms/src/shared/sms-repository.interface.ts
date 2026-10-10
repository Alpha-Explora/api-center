import type { SharedServiceCaller } from '@apicenter/runtime';
import type { SmsRecord } from './sms-store';

/** Every lookup takes the caller that created the record, so one owner never reads another owner's record. */
export interface SmsRepositoryInterface {
  save(record: SmsRecord, owner: SharedServiceCaller): Promise<SmsRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null>;
  applyDeliveryEvent(event: SmsDeliveryEvent): Promise<{ duplicate: boolean }>;
}

export interface SmsDeliveryEvent {
  providerEventId: string;
  messageId: string;
  status: 'accepted' | 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'read' | 'canceled';
  payload: unknown;
}
