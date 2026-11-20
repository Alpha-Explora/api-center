import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { OtpRepositoryInterface } from './otp-repository.interface';
import {
  DEFAULT_OTP_MESSAGE_TEMPLATE,
  EMPTY_OTP_SETTINGS,
  OTP_BOUNDS,
  hasOtpSettings,
  parseOtpSettingsInput,
  type OtpSettingsValues,
} from './project-settings';

const DEFAULTS = {
  codeLength: OTP_BOUNDS.codeLength.default,
  expirySeconds: OTP_BOUNDS.expirySeconds.default,
  maxAttempts: OTP_BOUNDS.maxAttempts.default,
  messageTemplate: DEFAULT_OTP_MESSAGE_TEMPLATE,
};

/** GET reads, PUT replaces and DELETE clears one project environment's OTP settings. */
export function createOtpSettingsAdminHandler(deps: { store: OtpRepositoryInterface; expectedToken: string | undefined }) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!tokenMatches(req.header('X-APICenter-Otp-Admin-Token') || undefined, deps.expectedToken)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'OTP admin token is invalid.' });
      return;
    }
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : undefined;
    const environment = req.params.environment;
    if (!projectId || !/^[A-Za-z0-9_-]{1,200}$/.test(projectId) || (environment !== 'test' && environment !== 'live')) {
      res.status(400).json({ error: 'INVALID_OTP_SETTINGS', message: 'Project or environment is invalid.' });
      return;
    }

    let values: OtpSettingsValues | undefined;
    if (req.method === 'PUT') {
      const parsed = parseOtpSettingsInput(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: 'INVALID_OTP_SETTINGS', message: parsed.message });
        return;
      }
      values = parsed.value;
    } else if (req.method === 'DELETE') {
      values = EMPTY_OTP_SETTINGS;
    } else if (req.method !== 'GET') {
      res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const record = values
        ? await deps.store.setProjectSettings({ projectId, environment, ...values })
        : await deps.store.getProjectSettings(projectId, environment);
      res.status(200).json({
        projectId,
        environment,
        configured: hasOtpSettings(record),
        codeLength: record?.codeLength ?? null,
        expirySeconds: record?.expirySeconds ?? null,
        maxAttempts: record?.maxAttempts ?? null,
        messageTemplate: record?.messageTemplate ?? null,
        defaults: DEFAULTS,
      });
    } catch {
      res.status(503).json({ error: 'OTP_SETTINGS_UNAVAILABLE', message: 'Project OTP settings are unavailable.' });
    }
  };
}

function tokenMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}
