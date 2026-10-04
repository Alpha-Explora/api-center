import { createEmailStore } from '../../shared/email-store';

export class GetEmailStatusService {
  constructor(private readonly store = createEmailStore()) {}

  async execute(messageId: string) {
    return this.store.findById(messageId);
  }
}
