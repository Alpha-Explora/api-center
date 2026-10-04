import path from 'node:path';
import { Request, Response } from 'express';
import {
  createFailureResponse,
  createScopedIdempotencyKey,
  createSharedIdempotencyStore,
  createSharedRateLimitStore,
  createSharedServiceApp,
  createSuccessResponse,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { GenerateOtpService } from './features/generate-otp/generate-otp.service';
import { VerifyOtpService } from './features/verify-otp/verify-otp.service';
import { GetOtpStatusService } from './features/get-otp-status/get-otp-status.service';
import { OtpTarget } from './features/generate-otp/generate-otp.model';

const port = Number(process.env.PORT || 4014);
const nodeEnv = process.env.NODE_ENV || 'development';
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'otp-gateway',
  health: {
    status: 'ok',
    service: 'otp-gateway',
    architecture: 'enterprise-feature-sliced',
    mode: process.env.OTP_STORE_MODE || 'memory',
  },
});

const generateOtpService = new GenerateOtpService();
const verifyOtpService = new VerifyOtpService();
const getOtpStatusService = new GetOtpStatusService();

const stateUrl = process.env.OTP_REDIS_URL || process.env.REDIS_URL;
const idempotencyStore = createSharedIdempotencyStore({ url: stateUrl, namespace: 'otp' });
const rateLimitStore = createSharedRateLimitStore({ url: stateUrl, namespace: 'otp' });
const idempotencyTtlMs = Number(process.env.OTP_IDEMPOTENCY_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const generateLimit = Number(process.env.OTP_GENERATE_LIMIT_PER_TARGET || 3);
const generateWindowMs = Number(process.env.OTP_GENERATE_LIMIT_WINDOW_MS || 60_000);
const verifyLimit = Number(process.env.OTP_VERIFY_LIMIT_PER_OTP || 5);
const verifyWindowMs = Number(process.env.OTP_VERIFY_LIMIT_WINDOW_MS || 60_000);

app.post('/generate', async (req: Request, res: Response) => {
  const { recipient, target, channel } = req.body || {};
  const rawTarget = recipient || target;

  if (!rawTarget || !channel) {
    return fail(res, 400, 'INVALID_REQUEST', 'recipient and channel are required');
  }

  if (channel !== 'sms' && channel !== 'email') {
    return fail(
      res,
      400,
      'INVALID_CHANNEL',
      'channel must be "sms" or "email"',
    );
  }

  try {
    new OtpTarget(rawTarget, channel);
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'Invalid OTP target');
  }

  const clientKey = req.get('Idempotency-Key');
  if (!clientKey?.trim() || clientKey.trim().length < 16 || clientKey.trim().length > 255) {
    return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be between 16 and 255 characters');
  }
  const storageKey = createScopedIdempotencyKey({
    namespace: 'otp',
    route: 'POST /generate',
    clientKey,
    sourceServiceId: req.get('X-APICenter-Source-Service-Id'),
    tribeId: req.get('X-Tribe-Id'),
    environment: req.get('X-APICenter-Environment'),
  });
  if (!storageKey) {
    return fail(res, 403, 'IDEMPOTENCY_CONTEXT_REQUIRED', 'Authenticated service, tribe, and environment context are required');
  }

  if (nodeEnv === 'production') {
    const providerConfigured = channel === 'sms'
      ? Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
        && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER))
      : Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS);
    if (!providerConfigured) return fail(res, 503, 'OTP_PROVIDER_UNAVAILABLE', 'OTP delivery provider is not configured');
  }

  let claim;
  try {
    claim = await idempotencyStore.claim(storageKey, req.body);
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
        ? ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'OTP delivery outcome is unknown; reconcile before using a new key']
        : ['IDEMPOTENCY_KEY_IN_PROGRESS', 'This idempotency key is already being processed'];
    return fail(res, 409, conflict[0], conflict[1]);
  }

  let limit;
  try {
    limit = await rateLimitStore.consume(`otp:generate:${String(rawTarget).toLowerCase()}`, {
      limit: generateLimit,
      windowMs: generateWindowMs,
    });
  } catch {
    try {
      await idempotencyStore.release(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'Rate-limit storage failed and the idempotency claim could not be released');
    }
    return fail(res, 503, 'RATE_LIMIT_UNAVAILABLE', 'OTP rate-limit storage is unavailable');
  }
  if (!limit.allowed) {
    try {
      await idempotencyStore.release(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The request was rate-limited but its idempotency claim could not be released');
    }
    return fail(res, 429, 'RATE_LIMITED', 'OTP generation limit exceeded for target.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  let result;
  try {
    result = await generateOtpService.execute(req.body);
  } catch (error: any) {
    try {
      await idempotencyStore.markUnknown(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'OTP may have been delivered, but its outcome could not be recorded');
    }
    return fail(res, 502, 'DELIVERY_FAILED', error?.message || 'Failed to deliver OTP');
  }

  const response = createSuccessResponse(result, 201);
  try {
    await idempotencyStore.complete(storageKey, req.body, response, { ttlMs: idempotencyTtlMs });
  } catch {
    try {
      await idempotencyStore.markUnknown(storageKey, req.body);
    } catch { /* The lease will expire into an unknown outcome. */ }
    return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'OTP was delivered but its response could not be recorded; reconcile before retrying');
  }
  return res.status(response.status).json(response.body);
});

app.post('/verify', async (req: Request, res: Response) => {
  const { otpId, code } = req.body || {};

  if (!otpId || !code) {
    return fail(res, 400, 'INVALID_REQUEST', 'otpId and code are required');
  }

  const clientKey = req.get('Idempotency-Key');
  if (!clientKey?.trim() || clientKey.trim().length < 16 || clientKey.trim().length > 255) {
    return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be between 16 and 255 characters');
  }
  const storageKey = createScopedIdempotencyKey({
    namespace: 'otp',
    route: 'POST /verify',
    clientKey,
    sourceServiceId: req.get('X-APICenter-Source-Service-Id'),
    tribeId: req.get('X-Tribe-Id'),
    environment: req.get('X-APICenter-Environment'),
  });
  if (!storageKey) {
    return fail(res, 403, 'IDEMPOTENCY_CONTEXT_REQUIRED', 'Authenticated service, tribe, and environment context are required');
  }

  let claim;
  try {
    claim = await idempotencyStore.claim(storageKey, req.body);
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
        ? ['IDEMPOTENCY_OUTCOME_UNKNOWN', 'OTP verification outcome is unknown; reconcile before using a new key']
        : ['IDEMPOTENCY_KEY_IN_PROGRESS', 'This idempotency key is already being processed'];
    return fail(res, 409, conflict[0], conflict[1]);
  }

  let limit;
  try {
    limit = await rateLimitStore.consume(`otp:verify:${otpId}`, {
      limit: verifyLimit,
      windowMs: verifyWindowMs,
    });
  } catch {
    try {
      await idempotencyStore.release(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'Rate-limit storage failed and the idempotency claim could not be released');
    }
    return fail(res, 503, 'RATE_LIMIT_UNAVAILABLE', 'OTP rate-limit storage is unavailable');
  }
  if (!limit.allowed) {
    try {
      await idempotencyStore.release(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_UNAVAILABLE', 'The request was rate-limited but its idempotency claim could not be released');
    }
    return fail(res, 429, 'RATE_LIMITED', 'OTP verification limit exceeded.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  try {
    const result = await verifyOtpService.execute(req.body);

    const response = result.verified
      ? createSuccessResponse(result)
      : createFailureResponse(
        result.reason === 'OTP_NOT_FOUND' ? 404 : 400,
        result.reason || 'OTP_INVALID',
        `OTP verification failed: ${result.reason}`,
      );
    await idempotencyStore.complete(storageKey, req.body, response, { ttlMs: idempotencyTtlMs });
    return res.status(response.status).json(response.body);
  } catch {
    try {
      await idempotencyStore.markUnknown(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'OTP verification may have completed, but its outcome could not be recorded');
    }
    return fail(res, 503, 'OTP_VERIFICATION_OUTCOME_UNKNOWN', 'OTP verification outcome could not be confirmed');
  }
});

app.get('/status/:otpId', async (req: Request, res: Response) => {
  const otpId = Array.isArray(req.params.otpId) ? req.params.otpId[0] : req.params.otpId;
  const result = await getOtpStatusService.execute(otpId);

  if (!result) {
    return fail(res, 404, 'OTP_NOT_FOUND', 'OTP not found');
  }

  return ok(res, result);
});

export async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../service-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'otp-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[otp-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

export { app };
