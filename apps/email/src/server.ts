import path from 'node:path';
import { Request, Response } from 'express';
import {
  createScopedIdempotencyKey,
  createSharedIdempotencyStore,
  createSharedRateLimitStore,
  createSharedServiceApp,
  readSharedServiceCaller,
  createSuccessResponse,
  type SharedServiceCaller,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { SendEmailService } from './features/send-email/send-email.service';
import { EmailRecipients, EmailSubject } from './features/send-email/send-email.model';
import { GetEmailStatusService } from './features/get-email-status/get-email-status.service';
import { createEmailStore } from './shared/email-store';
import { DailyLimitReachedError, SenderNotApprovedError } from './shared/email-policy-errors';
import { createProjectSenderAdminHandler } from './shared/project-sender-admin';

const port = Number(process.env.PORT || 4012);
const nodeEnv = process.env.NODE_ENV || 'development';

function readCaller(req: Request, res: Response): SharedServiceCaller | null {
  try {
    return readSharedServiceCaller(req);
  } catch (error) {
    fail(res, 403, 'CALLER_CONTEXT_REQUIRED', error instanceof Error ? error.message : 'Caller context is required');
    return null;
  }
}
const resendApiKey = process.env.RESEND_API_KEY;

const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'email-gateway',
  health: {
    status: 'ok',
    resendEnabled: !!resendApiKey,
    architecture: 'enterprise-feature-sliced',
    nodeEnv,
  },
});

const emailStore = createEmailStore();
const sendEmailService = new SendEmailService(emailStore);
const getEmailStatusService = new GetEmailStatusService(emailStore);
const projectSenderAdminHandler = createProjectSenderAdminHandler({
  store: emailStore,
  expectedToken: process.env.EMAIL_ADMIN_TOKEN,
});

const stateUrl = process.env.EMAIL_REDIS_URL || process.env.REDIS_URL;
const idempotencyStore = createSharedIdempotencyStore({ url: stateUrl, namespace: 'email' });
const rateLimitStore = createSharedRateLimitStore({ url: stateUrl, namespace: 'email' });
const sendLimit = Number(process.env.EMAIL_SEND_LIMIT_PER_RECIPIENT || 20);
const sendWindowMs = Number(process.env.EMAIL_SEND_LIMIT_WINDOW_MS || 60_000);
const idempotencyTtlMs = Number(process.env.EMAIL_IDEMPOTENCY_TTL_MS || 7 * 24 * 60 * 60 * 1000);

app.post('/send', async (req: Request, res: Response) => {
  const caller = readCaller(req, res);
  if (!caller) return;
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'templateId')) {
    return fail(res, 400, 'UNSUPPORTED_TEMPLATE_ID', 'templateId is no longer supported; send email content in html or text instead');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'templateVariables')) {
    return fail(res, 400, 'UNSUPPORTED_TEMPLATE_FIELD', 'templateVariables is no longer supported; send email content directly in html or text instead');
  }
  const { to, subject } = body;

  if (!to || !subject) {
    return fail(
      res,
      400,
      'INVALID_REQUEST',
      'Recipient (to) and subject are required',
    );
  }

  const hasHtml = typeof body.html === 'string' && body.html.trim().length > 0;
  const hasText = typeof body.text === 'string' && body.text.trim().length > 0;
  if (!hasHtml && !hasText) {
    return fail(res, 400, 'EMAIL_CONTENT_REQUIRED', 'Provide non-empty email content in html or text');
  }

  let recipients: string[];
  try {
    recipients = new EmailRecipients(to).getRecipients();
    new EmailSubject(subject);
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'Invalid email request');
  }

  const clientKey = req.get('Idempotency-Key');
  if (!clientKey?.trim() || clientKey.trim().length < 16 || clientKey.trim().length > 255) {
    return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be between 16 and 255 characters');
  }
  const sourceServiceId = req.get('X-APICenter-Source-Service-Id');
  const tribeId = req.get('X-Tribe-Id');
  const environment = req.get('X-APICenter-Environment');
  const storageKey = createScopedIdempotencyKey({
    namespace: 'email', route: 'POST /send', clientKey, sourceServiceId, tribeId, environment,
  });
  if (!storageKey) {
    return fail(res, 403, 'IDEMPOTENCY_CONTEXT_REQUIRED', 'Authenticated service, tribe, and environment context are required');
  }

  if (nodeEnv === 'production' && (!resendApiKey || !process.env.EMAIL_FROM_ADDRESS)) {
    return fail(res, 503, 'EMAIL_PROVIDER_UNAVAILABLE', 'Resend API key and sender address are required in production');
  }

  let claim;
  try {
    claim = await idempotencyStore.claim(storageKey, body);
  } catch {
    return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'Idempotency storage is unavailable');
  }
  if (claim.status === 'replay') {
    res.setHeader('x-idempotency-replayed', 'true');
    return res.status(claim.response.status).json(claim.response.body);
  }
  if (claim.status !== 'claimed') {
    const conflict = claim.status === 'payload_mismatch'
      ? ['IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', 'This idempotency key was already used with a different request']
      : claim.status === 'unknown'
        ? ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'The email delivery outcome is unknown; reconcile before using a new key']
        : ['IDEMPOTENCY_KEY_IN_PROGRESS', 'This idempotency key is already being processed'];
    return fail(res, 409, conflict[0], conflict[1]);
  }

  try {
    for (const recipient of recipients) {
      const limit = await rateLimitStore.consume(`email:send:${String(recipient).toLowerCase()}`, {
        limit: sendLimit,
        windowMs: sendWindowMs,
      });
      if (!limit.allowed) {
        try {
          await idempotencyStore.release(storageKey, body);
        } catch {
          return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The request was rate-limited but its idempotency claim could not be released');
        }
        return fail(res, 429, 'RATE_LIMITED', 'Email send limit exceeded for recipient.', {
          resetAt: new Date(limit.resetAt).toISOString(),
        });
      }
    }
  } catch {
    try {
      await idempotencyStore.release(storageKey, body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'Rate-limit storage failed and the idempotency claim could not be released');
    }
    return fail(res, 503, 'RATE_LIMIT_UNAVAILABLE', 'Email rate-limit storage is unavailable');
  }

  let data;
  try {
    data = await sendEmailService.execute(body, caller);
  } catch (error: any) {
    if (error instanceof SenderNotApprovedError || error instanceof DailyLimitReachedError) {
      try {
        await idempotencyStore.release(storageKey, body);
      } catch {
        return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The request was rejected but its idempotency claim could not be released');
      }
      return error instanceof SenderNotApprovedError
        ? fail(res, 403, error.code, error.message)
        : fail(res, 429, error.code, error.message);
    }
    try {
      await idempotencyStore.markUnknown(storageKey, body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'Email may have been sent, but its outcome could not be recorded');
    }
    return fail(res, 502, 'PROVIDER_ERROR', error?.message || 'Failed to send email via Resend');
  }

  const response = createSuccessResponse(data, 201);
  try {
    await idempotencyStore.complete(storageKey, body, response, { ttlMs: idempotencyTtlMs });
  } catch {
    try {
      await idempotencyStore.markUnknown(storageKey, body);
    } catch { /* The lease will expire into an unknown outcome. */ }
    return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'Email was sent but its response could not be recorded; reconcile before retrying');
  }
  return res.status(response.status).json(response.body);
});

app.put('/admin/projects/:projectId/email-sender/:environment', projectSenderAdminHandler);

app.post('/webhooks/resend', async (req: Request, res: Response) => {
  const event = req.body || {};
  const validStatuses = new Set(['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed', 'opened', 'clicked']);
  if (typeof event.providerEventId !== 'string' || !event.providerEventId ||
      typeof event.messageId !== 'string' || !event.messageId ||
      typeof event.status !== 'string' || !validStatuses.has(event.status) ||
      !event.payload || typeof event.payload !== 'object') {
    return fail(res, 400, 'INVALID_DELIVERY_EVENT', 'Resend delivery event is invalid');
  }
  try {
    const result = await emailStore.applyDeliveryEvent(event);
    return res.status(200).json({ received: true, ...result });
  } catch {
    return fail(res, 503, 'EMAIL_MESSAGE_PENDING', 'Email delivery event could not be applied yet');
  }
});

app.get('/status/:messageId', async (req: Request, res: Response) => {
  const caller = readCaller(req, res);
  if (!caller) return;
  const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const entry = await getEmailStatusService.execute(messageId, caller);

  if (!entry) {
    return fail(res, 404, 'NOT_FOUND', 'Message not found');
  }

  return ok(res, entry);
});

export async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../service-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'email-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[email-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

export { app };
