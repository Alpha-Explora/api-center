import { createSmsRepository, SmsRecord } from '../../shared/sms-store';
import type { SmsRepositoryInterface } from '../../shared/sms-repository.interface';

export class GetSmsStatusService {
  constructor(private readonly store: SmsRepositoryInterface = createSmsRepository()) {}

  async execute(messageId: string): Promise<SmsRecord | null> {
    return this.store.findById(messageId);
  }
}
