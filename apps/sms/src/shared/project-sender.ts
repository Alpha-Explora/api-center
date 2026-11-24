// A project environment may pin the SMS sender ID. Once pinned, every send uses it and a request
// naming another sender is refused. Without one, only the platform's own sender may be named: the
// messages go out on APICenter's Twilio account, so a free-form sender ID would let a tenant send
// as any brand.

export interface ProjectSmsSender {
  projectId: string;
  environment: 'test' | 'live';
  /** E.164 phone number or an alphanumeric sender ID; null when the project uses the platform sender. */
  senderId: string | null;
}

const E164 = /^\+[1-9]\d{6,14}$/;
/** Alphanumeric sender IDs: 1–11 letters, digits or spaces, with at least one letter. */
const ALPHANUMERIC_SENDER = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

export function isValidSmsSenderId(value: string): boolean {
  return E164.test(value) || ALPHANUMERIC_SENDER.test(value);
}

export class SmsSenderNotApprovedError extends Error {
  readonly code = 'SENDER_NOT_APPROVED';
  constructor() { super('The requested SMS sender is not approved for this project.'); }
}

/** The sender a send uses: the project's pinned sender, else the platform sender (undefined means its default). */
export function resolveSmsSender(
  requested: string | undefined,
  pinned: string | null | undefined,
  platformSender?: string,
): string | undefined {
  const asked = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined;
  const approved = pinned || platformSender?.trim() || undefined;
  if (asked !== undefined && asked !== approved) throw new SmsSenderNotApprovedError();
  return pinned || asked;
}
