import path from 'node:path';
import crypto from 'node:crypto';
import { Request, Response } from 'express';
import {
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import type {
  OtpGenerateRequest,
  OtpGenerateResponse,
  OtpVerifyRequest,
  OtpVerifyResponse,
} from '@apicenter/contracts';
import { createOtpStore } from './store';

const port = Number(process.env.PORT || 4014);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'otp-gateway',
  health: {
    status: 'ok',
    service: 'otp-gateway',
    mode: 'mock',
  },
});

const otpStore = createOtpStore();
const rateLimitStore = createMemoryRateLimitStore();
const generateLimit = Number(process.env.OTP_GENERATE_LIMIT_PER_TARGET || 3);
const generateWindowMs = Number(process.env.OTP_GENERATE_LIMIT_WINDOW_MS || 60_000);
const verifyLimit = Number(process.env.OTP_VERIFY_LIMIT_PER_OTP || 5);
const verifyWindowMs = Number(process.env.OTP_VERIFY_LIMIT_WINDOW_MS || 60_000);

app.post('/generate', async (req: Request, res: Response) => {
  const { recipient, channel, digits = 6, ttlSeconds = 300 } =
    (req.body || {}) as OtpGenerateRequest & { recipient?: string; target?: string; digits?: number };
  const target = recipient || (req.body as any)?.target;

  if (!target || !channel) {
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

  const limit = await rateLimitStore.consume(`otp:generate:${String(target).toLowerCase()}`, {
    limit: generateLimit,
    windowMs: generateWindowMs,
  });
  if (!limit.allowed) {
    return fail(res, 429, 'RATE_LIMITED', 'OTP generation limit exceeded for target.', {
      resetAt: new Date(limit.resetAt).toISOString(),
    });
  }

  const resolvedLength = Math.max(4, Math.min(10, Number(digits) || 6));
  const resolvedExpiry = Math.max(
    60,
    Math.min(3600, Number(ttlSeconds) || 300),
  );
  const max = Math.pow(10, resolvedLength);
  const code = String(crypto.randomInt(0, max)).padStart(resolvedLength, '0');
  const otpId = `otp_${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresAt = Date.now() + resolvedExpiry * 1000;

  await otpStore.createOtp({
    otpId,
    target,
    channel,
    code,
    expiresAt,
    status: 'pending',
  });

  const response: OtpGenerateResponse & { target: string; code?: string } = {
    otpId,
    expiresAt: new Date(expiresAt).toISOString(),
    channel,
    recipient: target,
    target,
    ...(process.env.NODE_ENV !== 'production' && { code }),
  };

  return ok(res, response, 201);
});

app.post('/verify', async (req: Request, res: Response) => {
  const { otpId, code } = (req.body || {}) as OtpVerifyRequest;

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

  const entry = await otpStore.getOtp(otpId);

  if (!entry) {
    return fail(res, 404, 'OTP_NOT_FOUND', 'OTP not found');
  }

  if (entry.status === 'used') {
    return fail(res, 400, 'OTP_ALREADY_USED', 'OTP has already been used');
  }

  if (entry.status === 'expired' || Date.now() > entry.expiresAt) {
    if (entry.status !== 'expired') {
      entry.status = 'expired';
      await otpStore.updateOtp(otpId, { status: 'expired' });
    }
    return fail(res, 400, 'OTP_EXPIRED', 'OTP has expired');
  }

  if (String(code) !== entry.code) {
    return fail(res, 400, 'OTP_INVALID', 'OTP code is incorrect');
  }

  entry.status = 'used';
  await otpStore.updateOtp(otpId, { status: 'used' });

  const response: OtpVerifyResponse & { target: string; channel: string } = {
    verified: true,
    otpId,
    target: entry.target,
    channel: entry.channel,
  };

  return ok(res, response);
});

app.get('/status/:otpId', async (req: Request, res: Response) => {
  const otpId = Array.isArray(req.params.otpId) ? req.params.otpId[0] : req.params.otpId;
  const entry = await otpStore.getOtp(otpId);

  if (!entry) {
    return fail(res, 404, 'OTP_NOT_FOUND', 'OTP not found');
  }

  if (entry.status === 'pending' && Date.now() > entry.expiresAt) {
    entry.status = 'expired';
    await otpStore.updateOtp(otpId, { status: 'expired' });
  }

  return ok(res, {
    otpId: entry.otpId,
    status: entry.status,
    target: entry.target,
    channel: entry.channel,
    expiresAt: new Date(entry.expiresAt).toISOString(),
  });
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
