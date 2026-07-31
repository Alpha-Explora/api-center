import path from 'node:path';
import { Request, Response } from 'express';
import {
  createMemoryIdempotencyStore,
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { SendEmailService } from './features/send-email/send-email.service';
import { GetEmailStatusService } from './features/get-email-status/get-email-status.service';
import { ListTemplatesService } from './features/list-templates/list-templates.service';

const port = Number(process.env.PORT || 4012);
const nodeEnv = process.env.NODE_ENV || 'development';
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

const sendEmailService = new SendEmailService();
const getEmailStatusService = new GetEmailStatusService();
const listTemplatesService = new ListTemplatesService();

const idempotencyStore = createMemoryIdempotencyStore();
const rateLimitStore = createMemoryRateLimitStore();
const sendLimit = Number(process.env.EMAIL_SEND_LIMIT_PER_RECIPIENT || 20);
const sendWindowMs = Number(process.env.EMAIL_SEND_LIMIT_WINDOW_MS || 60_000);
const idempotencyTtlMs = Number(process.env.EMAIL_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);

app.post('/send', async (req: Request, res: Response) => {
  const { to, subject } = req.body || {};

  if (!to || !subject) {
    return fail(
      res,
      400,
      'INVALID_REQUEST',
      'Recipient (to) and subject are required',
    );
  }

  const recipients = Array.isArray(to)
    ? to.map((r: any) => (typeof r === 'string' ? r : r.email))
    : [typeof to === 'string' ? to : to.email];
  const idempotencyKey = req.get('Idempotency-Key');

  if (idempotencyKey) {
    const existing = await idempotencyStore.get(`email:send:${idempotencyKey}`);
    if (existing) {
      return ok(res, { ...existing, idempotencyStatus: 'replayed' });
    }
  }

  for (const recipient of recipients) {
    const limit = await rateLimitStore.consume(`email:send:${String(recipient).toLowerCase()}`, {
      limit: sendLimit,
      windowMs: sendWindowMs,
    });
    if (!limit.allowed) {
      return fail(res, 429, 'RATE_LIMITED', 'Email send limit exceeded for recipient.', {
        resetAt: new Date(limit.resetAt).toISOString(),
      });
    }
  }

  try {
    const response = await sendEmailService.execute(req.body);

    if (idempotencyKey) {
      await idempotencyStore.set(`email:send:${idempotencyKey}`, response, { ttlMs: idempotencyTtlMs });
    }

    return ok(res, response, 201);
  } catch (error: any) {
    return fail(
      res,
      502,
      'PROVIDER_ERROR',
      error?.message || 'Failed to send email via Resend',
    );
  }
});

app.get('/status/:messageId', async (req: Request, res: Response) => {
  const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const entry = await getEmailStatusService.execute(messageId);

  if (!entry) {
    return fail(res, 404, 'NOT_FOUND', 'Message not found');
  }

  return ok(res, entry);
});

app.get('/templates', (_req: Request, res: Response) => {
  const templates = listTemplatesService.execute();
  return ok(res, templates);
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
