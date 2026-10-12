import { ApiCenterTransport } from './internal/transport';
import { EmailClient } from './services/email';
import { GeoClient } from './services/geo';
import { GoogleAuthClient } from './services/google-auth';
import { OtpClient } from './services/otp';
import { PaymentsNamespace } from './services/payments';
import { SmsClient } from './services/sms';
import type { ApiCenterOptions } from './types';

/** Server-side client for APICenter shared services and payments. */
export class ApiCenter {
  readonly email: EmailClient;
  readonly sms: SmsClient;
  readonly otp: OtpClient;
  readonly geo: GeoClient;
  readonly googleAuth: GoogleAuthClient;
  readonly payments: PaymentsNamespace;

  constructor(options: ApiCenterOptions) {
    const transport = new ApiCenterTransport(options);
    this.email = new EmailClient(transport);
    this.sms = new SmsClient(transport);
    this.otp = new OtpClient(transport);
    this.geo = new GeoClient(transport);
    this.googleAuth = new GoogleAuthClient(transport);
    this.payments = new PaymentsNamespace(transport);
  }
}
