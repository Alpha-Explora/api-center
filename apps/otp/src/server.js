const path = require('node:path');
const crypto = require('node:crypto');
const {
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway: registerSharedServiceWithGateway,
} = require('@apicenter/runtime');
const { createOtpStore } = require('./store');

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

app.post('/generate', async (req, res) => {
  const { target, channel, length = 6, expiresInSeconds = 300 } = req.body || {};

  if (!target || !channel) {
    return fail(res, 400, 'INVALID_REQUEST', 'target and channel are required');
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

  const resolvedLength = Math.max(4, Math.min(10, Number(length) || 6));
  const resolvedExpiry = Math.max(
    60,
    Math.min(3600, Number(expiresInSeconds) || 300),
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

  return ok(
    res,
    {
      otpId,
      expiresAt: new Date(expiresAt).toISOString(),
      channel,
      target,
      ...(process.env.NODE_ENV !== 'production' && { code }),
    },
    201,
  );
});

app.post('/verify', async (req, res) => {
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

  return ok(res, {
    valid: true,
    target: entry.target,
    channel: entry.channel,
  });
});

app.get('/status/:otpId', async (req, res) => {
  const { otpId } = req.params;
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

async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../service-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'otp-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[otp-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

module.exports = { app, registerWithGateway };
