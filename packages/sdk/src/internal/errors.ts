// Every failure the SDK raises is an ApiCenterError. Subclasses let callers branch on the kind of
// failure without comparing code strings; `code` still carries APICenter's exact error code.

export interface ApiCenterErrorOptions {
  status: number;
  code?: string;
  details?: unknown;
  /** APICenter's request ID; quote it when asking for support. */
  requestId?: string;
  /** Seconds the server asked the caller to wait before trying again. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class ApiCenterError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: ApiCenterErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** APICenter could not be reached, or did not answer in time (`code` is NETWORK_ERROR or REQUEST_TIMEOUT). */
export class ConnectionError extends ApiCenterError {}
/** The API key is missing, malformed, revoked or expired (401). */
export class AuthenticationError extends ApiCenterError {}
/** The application lacks a grant, or the capability or environment is not enabled (403). */
export class PermissionError extends ApiCenterError {}
/** The request was invalid (400 or 422). `details` lists the fields. */
export class ValidationError extends ApiCenterError {}
/** The resource does not exist, or belongs to another project (404). */
export class NotFoundError extends ApiCenterError {}
/** The request conflicts with the resource's state (409). */
export class ConflictError extends ApiCenterError {}
/** The idempotency key was reused with a different request, or is still in progress (409). */
export class IdempotencyError extends ConflictError {}
/** Too many requests (429). `retryAfterSeconds` says when to try again. */
export class RateLimitError extends ApiCenterError {}
/** The environment's request budget is used up (429, QUOTA_EXCEEDED). */
export class QuotaExceededError extends RateLimitError {}
/** APICenter or a provider behind it failed (5xx). */
export class ServerError extends ApiCenterError {}

/** The error class for an HTTP failure. */
export function errorFor(message: string, options: ApiCenterErrorOptions): ApiCenterError {
  const { status, code = '' } = options;
  if (status === 401) return new AuthenticationError(message, options);
  if (status === 403) return new PermissionError(message, options);
  if (status === 404) return new NotFoundError(message, options);
  if (status === 409) return code.startsWith('IDEMPOTENCY') ? new IdempotencyError(message, options) : new ConflictError(message, options);
  if (status === 400 || status === 422) return new ValidationError(message, options);
  if (status === 429) return code === 'QUOTA_EXCEEDED' ? new QuotaExceededError(message, options) : new RateLimitError(message, options);
  if (status >= 500) return new ServerError(message, options);
  return new ApiCenterError(message, options);
}
