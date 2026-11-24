import { Request, Response } from 'express';
import {
  createFailureResponse,
  createScopedIdempotencyKey,
  createSharedIdempotencyStore,
  createSharedRateLimitStore,
  createSharedServiceApp,
  readSharedServiceCaller,
  callerIdempotencyScope,
  recipientRateLimitKey,
  createSuccessResponse,
  createEmailSender,
  createSmsSender,
  MessagingProviderError,
  type SharedServiceCaller,
} from '@apicenter/runtime';
import { GenerateOtpService } from './features/generate-otp/generate-otp.service';
import { VerifyOtpService } from './features/verify-otp/verify-otp.service';
import { GetOtpStatusService } from './features/get-otp-status/get-otp-status.service';
import { OtpTarget } from './features/generate-otp/generate-otp.model';
import { createOtpRepository } from './shared/otp-store';
import { createOtpSettingsAdminHandler } from './shared/project-settings-admin';

const port = Number(process.env.PORT || 4014);
const nodeEnv = process.env.NODE_ENV || 'development';
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'otp-gateway',
  health: {
    status: 'ok',
    service: 'otp-gateway',
    architecture: 'enterprise-feature-sliced',
    recordStore: process.env.DATABASE_URL ? 'postgres' : 'memory',
  },
});

const otpSenders = { sms: createSmsSender(), email: createEmailSender() };
const generateOtpService = new GenerateOtpService(undefined, otpSenders);
const verifyOtpService = new VerifyOtpService();
const getOtpStatusService = new GetOtpStatusService();

const sharedState = { databaseUrl: process.env.DATABASE_URL, schema: 'shared_otp' };
const idempotencyStore = createSharedIdempotencyStore(sharedState);
const rateLimitStore = createSharedRateLimitStore(sharedState);
const idempotencyTtlMs = Number(process.env.OTP_IDEMPOTENCY_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const generateLimit = Number(process.env.OTP_GENERATE_LIMIT_PER_TARGET || 3);
const generateWindowMs = Number(process.env.OTP_GENERATE_LIMIT_WINDOW_MS || 60_000);
const verifyLimit = Number(process.env.OTP_VERIFY_LIMIT_PER_OTP || 5);
const verifyWindowMs = Number(process.env.OTP_VERIFY_LIMIT_WINDOW_MS || 60_000);

/** Audience the gateway signs control-plane application contexts for. */
const RUNTIME_AUDIENCE = 'apicenter-runtime:otp';

function readCaller(req: Request, res: Response): SharedServiceCaller | null {
  try {
    return readSharedServiceCaller(req, { runtimeAudience: RUNTIME_AUDIENCE });
  } catch (error) {
    fail(res, 403, 'CALLER_CONTEXT_REQUIRED', error instanceof Error ? error.message : 'Caller context is required');
    return null;
  }
}

app.post('/generate', async (req: Request, res: Response) => {
  const caller = readCaller(req, res);
  if (!caller) return;
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
    ...callerIdempotencyScope(caller),
  });
  if (!storageKey) {
    return fail(res, 403, 'IDEMPOTENCY_CONTEXT_REQUIRED', 'Authenticated service, tribe, and environment context are required');
  }

  if (nodeEnv === 'production') {
    const providerConfigured = channel === 'sms'
      ? otpSenders.sms.configured()
      : otpSenders.email.configured() && Boolean(process.env.EMAIL_FROM_ADDRESS);
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
    limit = await rateLimitStore.consume(recipientRateLimitKey('otp:generate', caller, rawTarget), {
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
    result = await generateOtpService.execute(req.body, caller);
  } catch (error: any) {
    try {
      await idempotencyStore.markUnknown(storageKey, req.body);
    } catch {
      return fail(res, 503, 'IDEMPOTENCY_OUTCOME_UNKNOWN', 'OTP may have been delivered, but its outcome could not be recorded');
    }
    // The provider's own answer stays in the log; callers get APICenter's message (ADR-0010).
    if (error instanceof MessagingProviderError) {
      console.warn(JSON.stringify({ type: 'apicenter_otp_provider_error', provider: error.provider, kind: error.kind, detail: error.detail }));
    }
    return fail(res, 502, 'DELIVERY_FAILED', error instanceof MessagingProviderError ? error.message : 'The code could not be delivered');
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
  const caller = readCaller(req, res);
  if (!caller) return;
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
    ...callerIdempotencyScope(caller),
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
    const result = await verifyOtpService.execute(req.body, caller);

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
  const caller = readCaller(req, res);
  if (!caller) return;
  const otpId = Array.isArray(req.params.otpId) ? req.params.otpId[0] : req.params.otpId;
  const result = await getOtpStatusService.execute(otpId, caller);

  if (!result) {
    return fail(res, 404, 'OTP_NOT_FOUND', 'OTP not found');
  }

  return ok(res, result);
});

const otpSettingsAdminHandler = createOtpSettingsAdminHandler({
  store: createOtpRepository(),
  expectedToken: process.env.OTP_ADMIN_TOKEN,
});
app.get('/admin/projects/:projectId/otp-settings/:environment', otpSettingsAdminHandler);
app.put('/admin/projects/:projectId/otp-settings/:environment', otpSettingsAdminHandler);
app.delete('/admin/projects/:projectId/otp-settings/:environment', otpSettingsAdminHandler);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[otp-gateway] listening on port ${port}`);
  });
}

export { app };
