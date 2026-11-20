import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SharedServiceCaller } from '@apicenter/runtime';
import type { EmailSendRequest } from '@alpha-explora/apicenter-contracts';
import { DailyLimitReachedError } from './email-policy-errors';

/**
 * The owner platform messages (console invites) are recorded under. It is not a control-plane
 * application: no gateway-signed context exists for it, and its daily limit and sender come from
 * this runtime's defaults (EMAIL_FROM_ADDRESS, EMAIL_DAILY_LIMIT_DEFAULT) unless a sender for project
 * 'apicenter-platform' is configured.
 */
export const PLATFORM_EMAIL_OWNER: SharedServiceCaller = Object.freeze({
  tribeId: 'apicenter-platform',
  projectId: 'apicenter-platform',
  serviceId: 'apicenter-gateway',
  environment: 'live',
  model: 'application',
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How a platform message is presented: the sender's name, and where replies go. */
export type PlatformMessageOptions = { fromName?: string; replyTo?: string };

type SendEmail = (
  input: EmailSendRequest,
  owner: SharedServiceCaller,
  options?: PlatformMessageOptions,
) => Promise<{ messageId: string; status: string; provider: string }>;

/** Counts one send to a recipient against the same per-recipient window `/send` uses. */
export type ConsumeRecipientLimit = (recipient: string) => Promise<{ allowed: boolean; resetAt: number }>;

/**
 * POST /admin/platform-messages: one message to one recipient, from the gateway, guarded by
 * EMAIL_ADMIN_TOKEN. The gateway uses it to send organization invites. `fromName` is shown in front
 * of the platform address and `replyTo` takes replies (the person who invited). The per-recipient
 * rate limit applies here too, so no caller can flood one inbox through the platform sender.
 */
export function createPlatformMessageAdminHandler(deps: {
  sendEmail: SendEmail;
  consumeRecipientLimit: ConsumeRecipientLimit;
  expectedToken: string | undefined;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!tokenMatches(req.header('X-APICenter-Email-Admin-Token') || undefined, deps.expectedToken)) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Email admin token is invalid.' });
      return;
    }
    const body = req.body ?? {};
    const keys = Object.keys(body);
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const text = typeof body.text === 'string' ? body.text : '';
    const html = body.html === undefined ? undefined : typeof body.html === 'string' ? body.html : null;
    const fromName = body.fromName === undefined ? undefined : typeof body.fromName === 'string' ? body.fromName.trim() : null;
    const replyTo = body.replyTo === undefined ? undefined : typeof body.replyTo === 'string' ? body.replyTo.trim() : null;
    if (
      keys.some((key) => !['to', 'subject', 'text', 'html', 'fromName', 'replyTo'].includes(key)) ||
      fromName === null || (fromName !== undefined && (!fromName || fromName.length > 80)) ||
      replyTo === null || (replyTo !== undefined && (!EMAIL.test(replyTo) || replyTo.length > 320)) ||
      !EMAIL.test(to) || to.length > 320 ||
      !subject || subject.length > 200 || /[\r\n]/.test(subject) ||
      !text.trim() || text.length > 20_000 ||
      html === null || (html !== undefined && html.length > 50_000)
    ) {
      res.status(400).json({ error: 'INVALID_PLATFORM_MESSAGE', message: 'Provide to, subject and text (and optionally html, fromName and replyTo).' });
      return;
    }
    try {
      const limit = await deps.consumeRecipientLimit(to.toLowerCase());
      if (!limit.allowed) {
        res.status(429).json({ error: 'RATE_LIMITED', message: 'Email send limit exceeded for recipient.', resetAt: new Date(limit.resetAt).toISOString() });
        return;
      }
    } catch {
      res.status(503).json({ error: 'RATE_LIMIT_UNAVAILABLE', message: 'Email rate-limit storage is unavailable' });
      return;
    }
    try {
      const sent = await deps.sendEmail({ to, subject, text, ...(html !== undefined ? { html } : {}) }, PLATFORM_EMAIL_OWNER, {
        ...(fromName ? { fromName } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      res.status(201).json({ success: true, data: { messageId: sent.messageId, status: sent.status, provider: sent.provider } });
    } catch (error) {
      if (error instanceof DailyLimitReachedError) {
        res.status(429).json({ error: error.code, message: error.message });
        return;
      }
      res.status(502).json({ error: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : 'The message could not be sent.' });
    }
  };
}

function tokenMatches(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}
