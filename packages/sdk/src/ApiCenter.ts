import { ApiCenterTransport } from './internal/transport.js';
import { EmailClient } from './services/email.js';
import { GeoClient } from './services/geo.js';
import { GoogleAuthClient } from './services/google-auth.js';
import { OtpClient } from './services/otp.js';
import { PaymentsNamespace } from './services/payments.js';
import { SmsClient } from './services/sms.js';
import type { ApiCenterOptions, RequestOptions } from './types.js';

/** The hosted APICenter gateway. The key's prefix selects test or live; there is one address. */
const API_BASE_URL = 'https://api.apicenter.itsandbox.site';
export const SDK_VERSION = '3.7.0';

/** Who the API key belongs to and what it may do. */
export interface WhoAmI {
  application: { id: string; slug: string; name: string };
  project: { id: string };
  organizationId: string;
  environment: 'test' | 'live';
  /** Granted actions, such as `email:send` or `payments:checkout:write`. */
  grants: string[];
}

/** Server-side client for APICenter shared services and payments. */
export class ApiCenter {
  /** `test` or `live`, from the API key. */
  readonly environment: 'test' | 'live';
  readonly email: EmailClient;
  readonly sms: SmsClient;
  readonly otp: OtpClient;
  readonly geo: GeoClient;
  readonly auth: { readonly google: GoogleAuthClient };
  readonly payments: PaymentsNamespace;
  private readonly transport: ApiCenterTransport;

  constructor(options: ApiCenterOptions = {}) {
    const apiKey = options.apiKey ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.APICENTER_API_KEY;
    if (!apiKey?.trim()) throw new TypeError('Set APICENTER_API_KEY or pass apiKey');
    this.transport = new ApiCenterTransport({
      apiKey,
      baseUrl: API_BASE_URL,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      hooks: options.hooks,
      sdkVersion: SDK_VERSION,
    });
    this.environment = this.transport.environment;
    this.email = new EmailClient(this.transport);
    this.sms = new SmsClient(this.transport);
    this.otp = new OtpClient(this.transport);
    this.geo = new GeoClient(this.transport);
    this.auth = { google: new GoogleAuthClient(this.transport) };
    this.payments = new PaymentsNamespace(this.transport);
  }

  /**
   * The application, project and environment of the API key, and its grants. Useful as a startup check.
   * @sdk-operation whoami GET /api/v1/whoami
   */
  whoami(options?: RequestOptions): Promise<WhoAmI> {
    return this.transport.request({ path: '/api/v1/whoami', method: 'GET', options });
  }
}
