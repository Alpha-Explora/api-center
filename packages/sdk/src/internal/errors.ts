export interface ApiCenterErrorOptions {
  status: number;
  code?: string;
  details?: unknown;
  correlationId?: string;
  cause?: unknown;
}

export class ApiCenterError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly correlationId?: string;

  constructor(message: string, options: ApiCenterErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiCenterError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.correlationId = options.correlationId;
  }
}
