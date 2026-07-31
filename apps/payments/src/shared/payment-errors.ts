export class PayMongoError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: any;

  constructor(message: string, statusCode = 502, code = 'PROVIDER_ERROR', details?: any) {
    super(message);
    this.name = 'PayMongoError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
