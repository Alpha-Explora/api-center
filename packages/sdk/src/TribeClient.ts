import { PaymentsClient } from './internal/payment';
import type { TribeClientOptions } from './types';

export class TribeClient {
  readonly payments: PaymentsClient;
  constructor(options: TribeClientOptions) { this.payments = new PaymentsClient(options); }
}
