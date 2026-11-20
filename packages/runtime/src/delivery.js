/** Send one SMS with Twilio and return the normalized delivery record. */
async function sendTwilioSms({ to, message, senderId, statusCallback }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = senderId || process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
    throw new Error('Twilio account, auth token, and sender configuration are required');
  }
  const form = new URLSearchParams({ To: to, Body: message });
  const callbackUrl = statusCallback || process.env.TWILIO_STATUS_CALLBACK_URL;
  if (callbackUrl) form.set('StatusCallback', callbackUrl);
  else if (process.env.NODE_ENV === 'production') throw new Error('Twilio status callback URL is required in production');
  if (messagingServiceSid && !senderId) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(Number(process.env.TWILIO_REQUEST_TIMEOUT_MS || 10000)),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.sid) throw new Error(body.message || `Twilio rejected SMS with HTTP ${response.status}`);
  const status = body.status === 'delivered' ? 'delivered'
    : body.status === 'sent' ? 'sent'
    : body.status === 'failed' || body.status === 'undelivered' ? 'failed'
    : 'queued';
  return { messageId: body.sid, status };
}

/**
 * `"Name" <address>` for a From header. The name is reduced to one line of printable text without
 * quotes, angle brackets or backslashes, so it cannot change the address or add a header.
 */
function formatSender(address, name) {
  // eslint-disable-next-line no-control-regex
  const cleaned = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f"<>\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() : '';
  return cleaned ? `"${cleaned}" <${address}>` : address;
}

/** Send one email with Resend and return its normalized delivery record. */
async function sendResendEmail({ to, subject, text, html, fromName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const address = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !address) throw new Error('Resend API key and sender address are required');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: formatSender(address, fromName), to: [to], subject, text, ...(html ? { html } : {}) }),
    signal: AbortSignal.timeout(Number(process.env.RESEND_REQUEST_TIMEOUT_MS || 10000)),
  });
  const body = await response.json();
  if (!response.ok || !body.id) throw new Error(body.message || `Resend rejected email with HTTP ${response.status}`);
  return { messageId: body.id, status: 'queued' };
}

module.exports = { sendTwilioSms, sendResendEmail, formatSender };
