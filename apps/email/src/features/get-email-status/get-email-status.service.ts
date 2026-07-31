import { MemoryEmailStore } from '../../shared/email-store';

export class GetEmailStatusService {
  constructor(private readonly store = MemoryEmailStore.getInstance()) {}

  async execute(messageId: string) {
    return this.store.findById(messageId);
  }
}
