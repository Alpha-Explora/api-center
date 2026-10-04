/** Send one SMS with Twilio and return the normalized delivery record. */
async function sendTwilioSms({ to, message, senderId }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = senderId || process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
    throw new Error('Twilio account, auth token, and sender configuration are required');
  }
  const form = new URLSearchParams({ To: to, Body: message });
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

/** Send one plain-text email with Resend and return its normalized delivery record. */
async function sendResendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !from) throw new Error('Resend API key and sender address are required');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(Number(process.env.RESEND_REQUEST_TIMEOUT_MS || 10000)),
  });
  const body = await response.json();
  if (!response.ok || !body.id) throw new Error(body.message || `Resend rejected email with HTTP ${response.status}`);
  return { messageId: body.id, status: 'queued' };
}

module.exports = { sendTwilioSms, sendResendEmail };
