/** What the provider actually answered. Logged, and used to classify outcomes; never returned to callers. */
export type ProviderErrorDetail = { status: number; code?: string; message?: string; body?: unknown };

export class PayMongoError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: any;
  /** The provider's HTTP status when this error came from a provider response. */
  public providerStatus?: number;
  public provider?: ProviderErrorDetail;

  constructor(message: string, statusCode = 502, code = 'PROVIDER_ERROR', details?: any) {
    super(message);
    this.name = 'PayMongoError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
