import path from 'node:path';
import { Request, Response } from 'express';
import {
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { GenerateOtpService } from './features/generate-otp/generate-otp.service';
import { VerifyOtpService } from './features/verify-otp/verify-otp.service';
import { GetOtpStatusService } from './features/get-otp-status/get-otp-status.service';

const port = Number(process.env.PORT || 4014);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'otp-gateway',
  health: {
    status: 'ok',
    service: 'otp-gateway',
    architecture: 'enterprise-feature-sliced',
    mode: 'memory',
  },
});

const generateOtpService = new GenerateOtpService();
const verifyOtpService = new VerifyOtpService();
const getOtpStatusService = new GetOtpStatusService();

const rateLimitStore = createMemoryRateLimitStore();
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

  const limit = await rateLimitStore.consume(`otp:generate:${String(rawTarget).toLowerCase()}`, {
    limit: generateLimit,
    windowMs: generateWindowMs,
  });
  if (!limit.allowed) {
    return fail(res, 429, 'RATE_LIMITED', 'OTP generation limit exceeded for target.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  try {
    const result = await generateOtpService.execute(req.body);
    return ok(res, result, 201);
  } catch (error: any) {
    return fail(res, 400, 'INVALID_REQUEST', error?.message || 'Failed to generate OTP');
  }
});

app.post('/verify', async (req: Request, res: Response) => {
  const { otpId, code } = req.body || {};

  if (!otpId || !code) {
    return fail(res, 400, 'INVALID_REQUEST', 'otpId and code are required');
  }

  const limit = await rateLimitStore.consume(`otp:verify:${otpId}`, {
    limit: verifyLimit,
    windowMs: verifyWindowMs,
  });
  if (!limit.allowed) {
    return fail(res, 429, 'RATE_LIMITED', 'OTP verification limit exceeded.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  const result = await verifyOtpService.execute(req.body);

  if (!result.verified) {
    const statusCode = result.reason === 'OTP_NOT_FOUND' ? 404 : 400;
    return fail(res, statusCode, result.reason || 'OTP_INVALID', `OTP verification failed: ${result.reason}`);
  }

  return ok(res, result);
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
