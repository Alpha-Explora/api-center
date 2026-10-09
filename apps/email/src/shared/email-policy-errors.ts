export class SenderNotApprovedError extends Error {
  readonly code = 'SENDER_NOT_APPROVED';
  constructor() { super('The requested email sender is not approved for this project.'); }
}

export class DailyLimitReachedError extends Error {
  readonly code = 'DAILY_LIMIT_REACHED';
  constructor() { super('The project email daily limit has been reached.'); }
}
