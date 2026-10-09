import type { SharedServiceCaller } from '@apicenter/runtime';
import { createSmsRepository, SmsRecord } from '../../shared/sms-store';
import type { SmsRepositoryInterface } from '../../shared/sms-repository.interface';

export class GetSmsStatusService {
  constructor(private readonly store: SmsRepositoryInterface = createSmsRepository()) {}

  async execute(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null> {
    return this.store.findById(messageId, owner);
  }
}
