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
import { SendSmsService } from './features/send-sms/send-sms.service';
import { SmsMessagePayload, SmsRecipient } from './features/send-sms/send-sms.model';
import { GetSmsStatusService } from './features/get-sms-status/get-sms-status.service';
import { SmsProviderError } from './shared/twilio-sms-provider';

const port = Number(process.env.PORT || 4011);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'sms-gateway',
  health: {
    status: 'ok',
    service: 'sms-gateway',
    architecture: 'feature-sliced',
    provider: 'twilio',
  },
});

const sendSmsService = new SendSmsService();
const getSmsStatusService = new GetSmsStatusService();
const stateUrl = process.env.SMS_REDIS_URL || process.env.REDIS_URL;
const idempotencyStore = createSharedIdempotencyStore({ url: stateUrl, namespace: 'sms' });
const rateLimitStore = createSharedRateLimitStore({ url: stateUrl, namespace: 'sms' });
const sendLimit = Number(process.env.SMS_SEND_LIMIT_PER_RECIPIENT || 10);
const sendWindowMs = Number(process.env.SMS_SEND_LIMIT_WINDOW_MS || 60_000);
const idempotencyTtlMs = Number(process.env.SMS_IDEMPOTENCY_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const nodeEnv = process.env.NODE_ENV || 'development';

function readCaller(req: Request, res: Response): SharedServiceCaller | null {
  try {
    return readSharedServiceCaller(req);
  } catch (error) {
    fail(res, 403, 'CALLER_CONTEXT_REQUIRED', error instanceof Error ? error.message : 'Caller context is required');
    return null;
  }
}

app.post('/send', async (req: Request, res: Response) => {
  const caller = readCaller(req, res);
  if (!caller) return;
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'templateId')) {
    return fail(res, 400, 'UNSUPPORTED_TEMPLATE_ID', 'templateId is no longer supported; send SMS content in message instead');
  }
  const { to, message } = body;

  if (!to || !message) {
    return fail(
      res,
      400,
      'INVALID_REQUEST',
      'Recipient (to) and message are required',
    );
  }

  try {
    new SmsRecipient(to);
    new SmsMessagePayload(message);
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'Invalid SMS request');
  }

  const clientKey = req.get('Idempotency-Key');
  if (!clientKey?.trim() || clientKey.trim().length < 16 || clientKey.trim().length > 255) {
    return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be between 16 and 255 characters');
  }
  const storageKey = createScopedIdempotencyKey({
    namespace: 'sms',
    route: 'POST /send',
    clientKey,
    sourceServiceId: req.get('X-APICenter-Source-Service-Id'),
    tribeId: req.get('X-Tribe-Id'),
    environment: req.get('X-APICenter-Environment'),
  });
  if (!storageKey) {
    return fail(res, 403, 'IDEMPOTENCY_CONTEXT_REQUIRED', 'Authenticated service, tribe, and environment context are required');
  }

  const senderConfigured = process.env.TWILIO_MESSAGING_SERVICE_SID
    || process.env.TWILIO_FROM_NUMBER || body.senderId;
  if (nodeEnv === 'production' && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !senderConfigured)) {
    return fail(res, 503, 'SMS_PROVIDER_UNAVAILABLE', 'Twilio credentials and sender configuration are required in production');
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
        ? ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'The SMS delivery outcome is unknown; reconcile before using a new key']
        : ['IDEMPOTENCY_KEY_IN_PROGRESS', 'This idempotency key is already being processed'];
    return fail(res, 409, conflict[0], conflict[1]);
  }

  let limit;
  try {
    limit = await rateLimitStore.consume(`sms:send:${String(to).toLowerCase()}`, {
      limit: sendLimit,
      windowMs: sendWindowMs,
    });
  } catch {
    try {
      await idempotencyStore.release(storageKey, body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'Rate-limit storage failed and the idempotency claim could not be released');
    }
    return fail(res, 503, 'RATE_LIMIT_UNAVAILABLE', 'SMS rate-limit storage is unavailable');
  }
  if (!limit.allowed) {
    try {
      await idempotencyStore.release(storageKey, body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The request was rate-limited but its idempotency claim could not be released');
    }
    return fail(res, 429, 'RATE_LIMITED', 'SMS send limit exceeded for recipient.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  let data;
  try {
    data = await sendSmsService.execute(body, caller);
  } catch (error: any) {
    try {
      await idempotencyStore.markUnknown(storageKey, body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'SMS may have been sent, but its outcome could not be recorded');
    }
    const providerError = error instanceof SmsProviderError;
    return fail(res, providerError ? error.statusCode : 503,
      providerError ? 'PROVIDER_ERROR' : 'SMS_DELIVERY_OUTCOME_UNKNOWN',
      error?.message || 'SMS delivery outcome could not be confirmed');
  }

  const response = createSuccessResponse(data, 201);
  try {
    await idempotencyStore.complete(storageKey, body, response, { ttlMs: idempotencyTtlMs });
  } catch {
    try {
      await idempotencyStore.markUnknown(storageKey, body);
    } catch { /* The lease will expire into an unknown outcome. */ }
    return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'SMS was sent but its response could not be recorded; reconcile before retrying');
  }
  return res.status(response.status).json(response.body);
});

app.get('/status/:messageId', async (req: Request, res: Response) => {
  const caller = readCaller(req, res);
  if (!caller) return;
  const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const entry = await getSmsStatusService.execute(messageId, caller);

  if (!entry) {
    return fail(res, 404, 'NOT_FOUND', 'Message not found');
  }

  return ok(res, entry);
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
