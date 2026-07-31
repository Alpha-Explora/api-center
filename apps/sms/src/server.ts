import path from 'node:path';
import { Request, Response } from 'express';
import {
  createMemoryIdempotencyStore,
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { SendSmsService } from './features/send-sms/send-sms.service';
import { GetSmsStatusService } from './features/get-sms-status/get-sms-status.service';

const port = Number(process.env.PORT || 4011);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'sms-gateway',
  health: {
    status: 'ok',
    service: 'sms-gateway',
    architecture: 'feature-sliced',
    mode: 'memory',
  },
});

const sendSmsService = new SendSmsService();
const getSmsStatusService = new GetSmsStatusService();
const idempotencyStore = createMemoryIdempotencyStore();
const rateLimitStore = createMemoryRateLimitStore();
const sendLimit = Number(process.env.SMS_SEND_LIMIT_PER_RECIPIENT || 10);
const sendWindowMs = Number(process.env.SMS_SEND_LIMIT_WINDOW_MS || 60_000);
const idempotencyTtlMs = Number(process.env.SMS_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);

app.post('/send', async (req: Request, res: Response) => {
  const { to, message } = req.body || {};

  if (!to || !message) {
    return fail(
      res,
      400,
      'INVALID_REQUEST',
      'Recipient (to) and message are required',
    );
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey) {
    const existing = await idempotencyStore.get(`sms:send:${idempotencyKey}`);
    if (existing) {
      return ok(res, { ...existing, idempotencyStatus: 'replayed' });
    }
  }

  const limit = await rateLimitStore.consume(`sms:send:${String(to).toLowerCase()}`, {
    limit: sendLimit,
    windowMs: sendWindowMs,
  });
  if (!limit.allowed) {
    return fail(res, 429, 'RATE_LIMITED', 'SMS send limit exceeded for recipient.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  try {
    const response = await sendSmsService.execute(req.body);

    if (idempotencyKey) {
      await idempotencyStore.set(`sms:send:${idempotencyKey}`, response, { ttlMs: idempotencyTtlMs });
    }

    return ok(res, response, 201);
  } catch (error: any) {
    return fail(res, 400, 'INVALID_REQUEST', error?.message || 'Failed to send SMS');
  }
});

app.get('/status/:messageId', async (req: Request, res: Response) => {
  const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const entry = await getSmsStatusService.execute(messageId);

  if (!entry) {
    return fail(res, 404, 'NOT_FOUND', 'Message not found');
  }

  return ok(res, entry);
});

app.get('/templates', (_req: Request, res: Response) => {
  return ok(res, ['otp', 'verification', 'notification']);
});

export async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../service-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'sms-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[sms-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

export { app };
