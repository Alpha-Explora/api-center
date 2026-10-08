import { PaymentsClient } from './internal/payment';
import { SharedServicesClient } from './internal/shared-services';
import type { TribeClientOptions } from './types';

export class TribeClient {
  readonly payments: PaymentsClient;
  readonly shared: SharedServicesClient;
  constructor(options: TribeClientOptions) {
    this.payments = new PaymentsClient(options);
    this.shared = new SharedServicesClient(options);
  }
}
