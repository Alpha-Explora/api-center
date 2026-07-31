import { SmsRecord } from './sms-store';

export interface SmsRepositoryInterface {
  save(record: SmsRecord): Promise<SmsRecord>;
  findById(messageId: string): Promise<SmsRecord | null>;
}
