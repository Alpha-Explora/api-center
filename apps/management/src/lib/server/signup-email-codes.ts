type SignupEmailCodeRecord = {
  code: string;
  email: string;
  expiresAt: number;
};

type SignupEmailRateLimitRecord = {
  count: number;
  resetAt: number;
};

const CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SENDS_PER_WINDOW = 5;

const globalForSignupCodes = globalThis as typeof globalThis & {
  __apicenterSignupEmailCodes?: Map<string, SignupEmailCodeRecord>;
  __apicenterSignupEmailRateLimits?: Map<string, SignupEmailRateLimitRecord>;
};

export function storeSignupEmailCode(input: {
  code: string;
  email: string;
  now?: number;
}) {
  getCodeStore().set(normalizeSignupEmail(input.email), {
    code: input.code,
    email: normalizeSignupEmail(input.email),
    expiresAt: (input.now ?? Date.now()) + CODE_TTL_MS,
  });
}

export function deleteSignupEmailCode(email: string) {
  getCodeStore().delete(normalizeSignupEmail(email));
}

export function verifySignupEmailCode(input: {
  code: string;
  email: string;
  now?: number;
}) {
  const email = normalizeSignupEmail(input.email);
  const record = getCodeStore().get(email);

  if (!record || record.expiresAt <= (input.now ?? Date.now())) {
    getCodeStore().delete(email);
    return { ok: false as const, reason: "expired" as const };
  }

  if (record.code !== input.code) {
    return { ok: false as const, reason: "mismatch" as const };
  }

  getCodeStore().delete(email);
  return { ok: true as const, email };
}

export function checkSignupEmailSendLimit(input: {
  email: string;
  now?: number;
}) {
  const email = normalizeSignupEmail(input.email);
  const now = input.now ?? Date.now();
  const maxSends = readPositiveInteger(
    process.env.SIGNUP_EMAIL_MAX_SENDS_PER_WINDOW,
    DEFAULT_MAX_SENDS_PER_WINDOW,
  );
  const windowMs = readPositiveInteger(
    process.env.SIGNUP_EMAIL_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_LIMIT_WINDOW_MS / 1000,
  ) * 1000;
  const limits = getRateLimitStore();
  const current = limits.get(email);

  if (!current || current.resetAt <= now) {
    limits.set(email, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true as const };
  }

  if (current.count >= maxSends) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  limits.set(email, current);
  return { allowed: true as const };
}

export function normalizeSignupEmail(email: string) {
  return email.trim().toLowerCase();
}

function getCodeStore() {
  globalForSignupCodes.__apicenterSignupEmailCodes ??=
    new Map<string, SignupEmailCodeRecord>();
  return globalForSignupCodes.__apicenterSignupEmailCodes;
}

function getRateLimitStore() {
  globalForSignupCodes.__apicenterSignupEmailRateLimits ??=
    new Map<string, SignupEmailRateLimitRecord>();
  return globalForSignupCodes.__apicenterSignupEmailRateLimits;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
