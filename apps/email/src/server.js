const path = require('node:path');
const { Resend } = require('resend');
const crypto = require('node:crypto');
const {
  createMemoryIdempotencyStore,
  createMemoryRateLimitStore,
  createSharedServiceApp,
  registerWithGateway: registerSharedServiceWithGateway,
} = require('@apicenter/runtime');

const port = Number(process.env.PORT || 4012);
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev';
const nodeEnv = process.env.NODE_ENV || 'development';
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const messageStore = new Map();
const idempotencyStore = createMemoryIdempotencyStore();
const rateLimitStore = createMemoryRateLimitStore();
const sendLimit = Number(process.env.EMAIL_SEND_LIMIT_PER_RECIPIENT || 20);
const sendWindowMs = Number(process.env.EMAIL_SEND_LIMIT_WINDOW_MS || 60_000);
const idempotencyTtlMs = Number(process.env.EMAIL_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'email-gateway',
  health: {
    status: 'ok',
    resendEnabled: !!resend,
    nodeEnv,
  },
});

// Matches SDK EmailSendRequest: { to: string|string[], subject, html?, text?, templateId?, templateData? }
app.post('/send', async (req, res) => {
  const { to, subject, html, text, templateId, templateData, metadata } =
    req.body || {};

  if (!to || !subject) {
    return fail(
      res,
      400,
      'INVALID_REQUEST',
      'Recipient (to) and subject are required',
    );
  }

  const recipients = Array.isArray(to)
    ? to.map((r) => (typeof r === 'string' ? r : r.email))
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

  const htmlContent = html || (text ? `<p>${text}</p>` : '<p>(no content)</p>');
  const resolvedSubject = subject;

  if (!resend && nodeEnv === 'production') {
    return fail(
      res,
      500,
      'CONFIG_ERROR',
      'Resend API key is not configured in production environment',
    );
  }

  try {
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
    let providerMessageId = messageId;
    let status = 'mock_sent';

    if (resend) {
      const payload = {
        from: emailFrom,
        to: recipients,
        subject: resolvedSubject,
        html: htmlContent,
      };
      if (templateId) {
        // eslint-disable-next-line no-console
        console.log(
          `[email-gateway] templateId=${templateId} templateData=${JSON.stringify(templateData)}`,
        );
      }
      const { data, error } = await resend.emails.send(payload);
      if (error) throw new Error(error.message);
      providerMessageId = data.id;
      status = 'sent';
    }

    const response = {
      messageId: providerMessageId,
      provider: resend ? 'resend' : 'mock',
      status,
      recipient: recipients,
    };

    messageStore.set(providerMessageId, {
      messageId: providerMessageId,
      provider: resend ? 'resend' : 'mock',
      status,
      recipient: recipients,
      metadata,
      createdAt: new Date().toISOString(),
    });

    if (idempotencyKey) {
      await idempotencyStore.set(`email:send:${idempotencyKey}`, response, { ttlMs: idempotencyTtlMs });
    }

    return ok(res, response, 201);
  } catch (error) {
    return fail(
      res,
      502,
      'PROVIDER_ERROR',
      error.message || 'Failed to send email via Resend',
    );
  }
});

app.get('/status/:messageId', (req, res) => {
  const entry = messageStore.get(req.params.messageId);

  if (!entry) {
    return fail(res, 404, 'NOT_FOUND', 'Message not found');
  }

  return ok(res, entry);
});

app.get('/templates', (_req, res) => {
  return ok(res, [
    'account_verification',
    'password_reset',
    'general_notification',
  ]);
});

async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(
      __dirname,
      '../service-manifest.json',
    ),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'email-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[email-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

module.exports = { app, registerWithGateway };
