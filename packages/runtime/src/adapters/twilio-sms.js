// Twilio Programmable Messaging. Only this file knows Twilio's API.

function createTwilioSmsSender(env, ProviderError) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  const defaultFrom = env.TWILIO_FROM_NUMBER;
  const hasPlatformSender = () => Boolean(messagingServiceSid || defaultFrom);

  return {
    provider: 'twilio',
    defaultSenderId: defaultFrom || undefined,
    hasPlatformSender,
    configured: (senderId) => Boolean(accountSid && authToken && (hasPlatformSender() || senderId)),
    async send({ to, message, senderId, statusCallback }) {
      const from = senderId || defaultFrom;
      if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
        throw new ProviderError('not_configured', 'twilio', 'Twilio account, auth token, and sender configuration are required');
      }
      const form = new URLSearchParams({ To: to, Body: message });
      const callbackUrl = statusCallback || env.TWILIO_STATUS_CALLBACK_URL;
      if (callbackUrl) form.set('StatusCallback', callbackUrl);
      else if (env.NODE_ENV === 'production') {
        throw new ProviderError('not_configured', 'twilio', 'Twilio status callback URL is required in production');
      }
      if (messagingServiceSid && !senderId) form.set('MessagingServiceSid', messagingServiceSid);
      else form.set('From', from);
      let response;
      try {
        response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: form,
            signal: AbortSignal.timeout(Number(env.TWILIO_REQUEST_TIMEOUT_MS || 10000)),
          },
        );
      } catch (error) {
        throw new ProviderError('unreachable', 'twilio', error instanceof Error ? error.message : String(error));
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.sid) {
        throw new ProviderError('rejected', 'twilio', body.message || `HTTP ${response.status}`);
      }
      const status = body.status === 'delivered' ? 'delivered'
        : body.status === 'sent' ? 'sent'
          : body.status === 'failed' || body.status === 'undelivered' ? 'failed'
            : 'queued';
      return { providerMessageId: body.sid, status };
    },
  };
}

module.exports = { createTwilioSmsSender };
