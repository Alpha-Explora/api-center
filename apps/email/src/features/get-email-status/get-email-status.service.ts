import type { SharedServiceCaller } from '@apicenter/runtime';
import { createEmailStore } from '../../shared/email-store';

export class GetEmailStatusService {
  constructor(private readonly store = createEmailStore()) {}

  async execute(messageId: string, owner: SharedServiceCaller) {
    return this.store.findById(messageId, owner);
  }
}
