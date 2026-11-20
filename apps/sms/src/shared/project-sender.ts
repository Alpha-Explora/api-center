// A project environment may pin the SMS sender ID. Once pinned, every send uses it and a request
// naming another sender is refused; without one, a request's senderId (or the platform's Twilio
// sender) is used as before.

export interface ProjectSmsSender {
  projectId: string;
  environment: 'test' | 'live';
  /** E.164 phone number or an alphanumeric sender ID; null when the project uses the platform sender. */
  senderId: string | null;
}

const E164 = /^\+[1-9]\d{6,14}$/;
/** Twilio alphanumeric sender IDs: 1–11 letters, digits or spaces, with at least one letter. */
const ALPHANUMERIC_SENDER = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

export function isValidSmsSenderId(value: string): boolean {
  return E164.test(value) || ALPHANUMERIC_SENDER.test(value);
}

export class SmsSenderNotApprovedError extends Error {
  readonly code = 'SENDER_NOT_APPROVED';
  constructor() { super('The requested SMS sender is not approved for this project.'); }
}

/** The sender a send uses: the project's pinned sender, else whatever the request asked for. */
export function resolveSmsSender(requested: string | undefined, pinned: string | null | undefined): string | undefined {
  const asked = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined;
  if (!pinned) return asked;
  if (asked !== undefined && asked !== pinned) throw new SmsSenderNotApprovedError();
  return pinned;
}
