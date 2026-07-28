const path = require('node:path');
const crypto = require('node:crypto');
const {
  createMemoryIdempotencyStore,
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway: registerSharedServiceWithGateway,
} = require('@apicenter/runtime');
const { createSmsStore } = require('./store');

const port = Number(process.env.PORT || 4011);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'sms-gateway',
  health: {
    status: 'ok',
    service: 'sms-gateway',
    mode: 'mock',
  },
});

const messageStore = createSmsStore();
const idempotencyStore = createMemoryIdempotencyStore();
const rateLimitStore = createMemoryRateLimitStore();
const sendLimit = Number(process.env.SMS_SEND_LIMIT_PER_RECIPIENT || 10);
const sendWindowMs = Number(process.env.SMS_SEND_LIMIT_WINDOW_MS || 60_000);
const idempotencyTtlMs = Number(process.env.SMS_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);

app.post('/send', async (req, res) => {
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

  const messageId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
  const response = {
    messageId,
    status: 'mock_sent',
    recipient: to,
  };

  await messageStore.createMessage({
    messageId,
    to,
    message,
    status: 'mock_sent',
    createdAt: new Date().toISOString(),
  });

  if (idempotencyKey) {
    await idempotencyStore.set(`sms:send:${idempotencyKey}`, response, { ttlMs: idempotencyTtlMs });
  }

  return ok(res, response, 201);
});

app.get('/status/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const entry = await messageStore.getMessage(messageId);

  if (!entry) {
    return fail(res, 404, 'NOT_FOUND', 'Message not found');
  }

  return ok(res, entry);
});

app.get('/templates', (_req, res) => {
  return ok(res, ['otp', 'verification', 'notification']);
});

async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../../manifests/sms-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'sms-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[sms-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

module.exports = { app, registerWithGateway };
