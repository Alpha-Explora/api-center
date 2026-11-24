// SMS and email senders (ADR-0010). Runtimes send through createSmsSender() and createEmailSender(); only the
// adapters in ./adapters know a provider's API. SMS_PROVIDER and EMAIL_PROVIDER select the adapter.
const { recordProviderMetric } = require('./metrics');
const { createTwilioSmsSender } = require('./adapters/twilio-sms');
const { createResendEmailSender } = require('./adapters/resend-email');
const { createMockSmsSender, createMockEmailSender } = require('./adapters/mock-messaging');

/**
 * A provider send failed. `message` is safe to return to callers; `detail` is the provider's own answer and
 * belongs in logs only. `not_configured` means nothing was sent; `rejected` means the provider refused it;
 * `unreachable` means the outcome is unknown.
 */
class MessagingProviderError extends Error {
  constructor(kind, provider, detail) {
    super(kind === 'not_configured' ? 'The message provider is not configured'
      : kind === 'rejected' ? 'The message provider rejected the message'
        : 'The message provider could not be reached');
    this.name = 'MessagingProviderError';
    this.kind = kind;
    this.provider = provider;
    this.detail = detail;
    this.statusCode = kind === 'not_configured' ? 503 : 502;
  }
}

/** Records one latency metric per send, whatever the adapter. */
function measured(sender, operation) {
  return {
    ...sender,
    provider: sender.provider,
    configured: (...args) => sender.configured(...args),
    async send(input) {
      const startedAt = Date.now();
      try {
        const result = await sender.send(input);
        recordProviderMetric({ serviceId: 'messaging', provider: sender.provider, operation, status: 'success', latencyMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        recordProviderMetric({ serviceId: 'messaging', provider: sender.provider, operation, status: 'error', latencyMs: Date.now() - startedAt });
        throw error;
      }
    },
  };
}

function createSmsSender(env = process.env) {
  const choice = env.SMS_PROVIDER || 'twilio';
  if (choice === 'twilio') return measured(createTwilioSmsSender(env, MessagingProviderError), 'send_sms');
  if (choice === 'mock') return createMockSmsSender();
  throw new Error(`Unknown SMS_PROVIDER: ${choice}`);
}

function createEmailSender(env = process.env) {
  const choice = env.EMAIL_PROVIDER || 'resend';
  if (choice === 'resend') return measured(createResendEmailSender(env, MessagingProviderError), 'send_email');
  if (choice === 'mock') return createMockEmailSender();
  throw new Error(`Unknown EMAIL_PROVIDER: ${choice}`);
}

module.exports = { MessagingProviderError, createSmsSender, createEmailSender };
