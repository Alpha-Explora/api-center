// Resend's email API. Only this file knows Resend's API.

function createResendEmailSender(env, ProviderError) {
  const apiKey = env.RESEND_API_KEY;

  return {
    provider: 'resend',
    configured: () => Boolean(apiKey),
    async send({ to, from, subject, text, html, replyTo }) {
      if (!apiKey) throw new ProviderError('not_configured', 'resend', 'Resend API key is required');
      let response;
      try {
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to, subject, ...(text !== undefined ? { text } : {}),
            ...(html !== undefined ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
          signal: AbortSignal.timeout(Number(env.RESEND_REQUEST_TIMEOUT_MS || 10000)),
        });
      } catch (error) {
        throw new ProviderError('unreachable', 'resend', error instanceof Error ? error.message : String(error));
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) throw new ProviderError('rejected', 'resend', body.message || `HTTP ${response.status}`);
      return { providerMessageId: body.id };
    },
  };
}

module.exports = { createResendEmailSender };
