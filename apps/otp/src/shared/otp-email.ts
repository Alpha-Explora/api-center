// The email a verification code is sent in. Pure, so tests and the runtime build the same message.
//
// The project's name leads (sender, subject, body) because the people receiving the code are the
// project's own users; a footer line says APICenter sent it, so the message is honest about where
// it came from. The body text is the project's one-line template, held to the template rules.

import { expiryMinutes } from './project-settings';

export interface OtpEmail {
  fromName: string;
  subject: string;
  text: string;
  html: string;
}

export function otpEmail(input: { projectName: string; code: string; ttlSeconds: number; message: string }): OtpEmail {
  const minutes = expiryMinutes(input.ttlSeconds);
  const expiry = `This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Never share it with anyone.`;
  const ignore = "If you didn't ask for this code, you can ignore this email.";
  const footer = `Sent by APICenter for ${input.projectName}.`;
  const name = escapeHtml(input.projectName);
  return {
    fromName: input.projectName,
    subject: `Your ${input.projectName} verification code`,
    text: [input.message, '', expiry, '', ignore, footer].join('\n'),
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your ${name} verification code</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2328;">
<tr><td style="padding:28px 28px 8px;">
<p style="margin:0 0 6px;font-size:13px;color:#57606a;">${name}</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0d1117;">Your verification code</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.55;">${escapeHtml(input.message)}</p>
<div style="margin:0 0 16px;padding:14px 16px;background:#f6f8fa;border:1px solid #e5e7eb;border-radius:8px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:0.3em;color:#0d1117;">${escapeHtml(input.code)}</div>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#57606a;">${escapeHtml(expiry)}</p>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #eef0f2;font-size:12px;line-height:1.5;color:#6e7781;">${escapeHtml(ignore)}<br>${escapeHtml(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
