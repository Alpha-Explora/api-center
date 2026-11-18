import { ApiCenterTransport, type ApiCenterTransportOptions } from './internal/transport';
import { EmailClient } from './services/email';
import { GeoClient } from './services/geo';
import { GoogleAuthClient } from './services/google-auth';
import { OtpClient } from './services/otp';
import { PaymentsNamespace } from './services/payments';
import { SmsClient } from './services/sms';
import { SetupClient } from './services/setup';
import type { ApiCenterOptions } from './types';

/** The hosted APICenter gateway, used when neither `baseUrl` nor `APICENTER_URL` is set. */
export const DEFAULT_BASE_URL = 'https://api.apicenter.itsandbox.site';

/** Fill unset options from `APICENTER_URL` and `APICENTER_API_KEY`; explicit options always win. */
function resolveOptions(options: ApiCenterOptions): ApiCenterTransportOptions {
  const env = typeof process === 'undefined' ? {} : process.env;
  const apiKey = env.APICENTER_API_KEY?.trim();
  return {
    ...options,
    baseUrl: options.baseUrl ?? (env.APICENTER_URL?.trim() || DEFAULT_BASE_URL),
    auth: options.auth ?? (apiKey ? { apiKey } : undefined),
  };
}

/** Server-side client for APICenter shared services and payments. */
export class ApiCenter {
  readonly email: EmailClient;
  readonly sms: SmsClient;
  readonly otp: OtpClient;
  readonly geo: GeoClient;
  readonly googleAuth: GoogleAuthClient;
  readonly payments: PaymentsNamespace;
  readonly setup: SetupClient;

  constructor(options: ApiCenterOptions = {}) {
    const transport = new ApiCenterTransport(resolveOptions(options));
    this.email = new EmailClient(transport);
    this.sms = new SmsClient(transport);
    this.otp = new OtpClient(transport);
    this.geo = new GeoClient(transport);
    this.googleAuth = new GoogleAuthClient(transport);
    this.payments = new PaymentsNamespace(transport);
    this.setup = new SetupClient(transport);
  }
}
