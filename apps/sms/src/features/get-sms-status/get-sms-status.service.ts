import { MemorySmsStore, SmsRecord } from '../../shared/sms-store';

export class GetSmsStatusService {
  constructor(private readonly store = MemorySmsStore.getInstance()) {}

  async execute(messageId: string): Promise<SmsRecord | null> {
    return this.store.findById(messageId);
  }
}
