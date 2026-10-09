import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailRecord } from './email-store';

/** Every lookup takes the caller that created the message, so one owner never reads another owner's record. */
export interface EmailRepositoryInterface {
  save(record: EmailRecord, owner: SharedServiceCaller): Promise<EmailRecord>;
  findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null>;
}
