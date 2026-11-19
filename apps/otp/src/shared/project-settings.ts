// Per-project OTP settings. Code length and expiry are the project's defaults: a request's `digits`
// or `ttlSeconds` still wins, within the platform bounds. The attempt cap and the message template
// always apply. A null field means the platform default.

export interface OtpProjectSettings {
  projectId: string;
  environment: 'test' | 'live';
  codeLength: number | null;
  expirySeconds: number | null;
  maxAttempts: number | null;
  messageTemplate: string | null;
}

export type OtpSettingsValues = Pick<OtpProjectSettings, 'codeLength' | 'expirySeconds' | 'maxAttempts' | 'messageTemplate'>;

export const OTP_BOUNDS = {
  codeLength: { min: 4, max: 10, default: 6 },
  expirySeconds: { min: 60, max: 3600, default: 300 },
  maxAttempts: { min: 1, max: 10 },
  messageTemplateMaxLength: 300,
} as const;

export const DEFAULT_OTP_MESSAGE_TEMPLATE = 'Your APICenter verification code is {{code}}';

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;
const KNOWN_PLACEHOLDERS = new Set(['code', 'minutes']);

export const EMPTY_OTP_SETTINGS: OtpSettingsValues = { codeLength: null, expirySeconds: null, maxAttempts: null, messageTemplate: null };

export function hasOtpSettings(values: OtpSettingsValues | null | undefined): boolean {
  return Boolean(values) &&
    (values!.codeLength !== null || values!.expirySeconds !== null || values!.maxAttempts !== null || values!.messageTemplate !== null);
}

/** Parses a PUT body. Omitted fields are cleared, so a PUT replaces the whole configuration. */
export function parseOtpSettingsInput(body: unknown): { ok: true; value: OtpSettingsValues } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Expected a JSON object.' };
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !(key in EMPTY_OTP_SETTINGS));
  if (unknown.length) return { ok: false, message: `Unknown setting: ${unknown[0]}.` };

  const integer = (key: 'codeLength' | 'expirySeconds' | 'maxAttempts', min: number, max: number) => {
    const value = input[key];
    if (value === undefined || value === null) return { ok: true as const, value: null };
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      return { ok: false as const, message: `${key} must be a whole number from ${min} to ${max}, or null.` };
    }
    return { ok: true as const, value };
  };
  const codeLength = integer('codeLength', OTP_BOUNDS.codeLength.min, OTP_BOUNDS.codeLength.max);
  if (!codeLength.ok) return codeLength;
  const expirySeconds = integer('expirySeconds', OTP_BOUNDS.expirySeconds.min, OTP_BOUNDS.expirySeconds.max);
  if (!expirySeconds.ok) return expirySeconds;
  const maxAttempts = integer('maxAttempts', OTP_BOUNDS.maxAttempts.min, OTP_BOUNDS.maxAttempts.max);
  if (!maxAttempts.ok) return maxAttempts;

  let messageTemplate: string | null = null;
  if (input.messageTemplate !== undefined && input.messageTemplate !== null) {
    if (typeof input.messageTemplate !== 'string') return { ok: false, message: 'messageTemplate must be a string or null.' };
    const problem = otpTemplateProblem(input.messageTemplate.trim());
    if (problem) return { ok: false, message: problem };
    messageTemplate = input.messageTemplate.trim();
  }
  return { ok: true, value: { codeLength: codeLength.value, expirySeconds: expirySeconds.value, maxAttempts: maxAttempts.value, messageTemplate } };
}

/** Why a message template is unusable, or null when it is fine. */
export function otpTemplateProblem(template: string): string | null {
  if (!template) return 'messageTemplate must not be empty.';
  if (template.length > OTP_BOUNDS.messageTemplateMaxLength) {
    return `messageTemplate must be at most ${OTP_BOUNDS.messageTemplateMaxLength} characters.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(template)) return 'messageTemplate must not contain control characters.';
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
  const unknown = names.find((name) => !KNOWN_PLACEHOLDERS.has(name));
  if (unknown) return `messageTemplate may use only {{code}} and {{minutes}}; found {{${unknown}}}.`;
  if (!names.includes('code')) return 'messageTemplate must include {{code}}.';
  return null;
}

export interface OtpPolicy {
  digits: number;
  ttlSeconds: number;
  maxAttempts: number | null;
  template: string;
}

/** The policy one generation uses: request values, then project settings, then platform defaults. */
export function resolveOtpPolicy(request: { digits?: unknown; ttlSeconds?: unknown }, settings: OtpSettingsValues | null): OtpPolicy {
  const pick = (requested: unknown, configured: number | null | undefined, bounds: { min: number; max: number; default: number }) => {
    const value = Number(requested) || configured || bounds.default;
    return Math.max(bounds.min, Math.min(bounds.max, value));
  };
  return {
    digits: pick(request.digits, settings?.codeLength, OTP_BOUNDS.codeLength),
    ttlSeconds: pick(request.ttlSeconds, settings?.expirySeconds, OTP_BOUNDS.expirySeconds),
    maxAttempts: settings?.maxAttempts ?? null,
    template: settings?.messageTemplate ?? DEFAULT_OTP_MESSAGE_TEMPLATE,
  };
}

export function renderOtpMessage(template: string, code: string, ttlSeconds: number): string {
  const minutes = String(Math.max(1, Math.round(ttlSeconds / 60)));
  return template.replace(PLACEHOLDER, (_match, name: string) => (name === 'code' ? code : minutes));
}
