import crypto from 'node:crypto';
import { Resend } from 'resend';
import type { EmailSendRequest, EmailSendResponse } from '@apicenter/contracts';
import { EmailRecipients, EmailSubject } from './send-email.model';
import { MemoryEmailStore } from '../../shared/email-store';

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev';
const nodeEnv = process.env.NODE_ENV || 'development';
const resend = resendApiKey ? new Resend(resendApiKey) : null;

export class SendEmailService {
  constructor(private readonly store = MemoryEmailStore.getInstance()) {}

  async execute(input: EmailSendRequest): Promise<EmailSendResponse & { provider: string; recipient: string[] }> {
    const recipientsVo = new EmailRecipients(input.to);
    const subjectVo = new EmailSubject(input.subject);

    const recipients = recipientsVo.getRecipients();
    const htmlContent = input.html || (input.text ? `<p>${input.text}</p>` : '<p>(no content)</p>');

    if (!resend && nodeEnv === 'production') {
      throw new Error('Resend API key is not configured in production environment');
    }

    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
    let providerMessageId = messageId;
    let status = 'mock_sent';

    if (resend) {
      const payload = {
        from: emailFrom,
        to: recipients,
        subject: subjectVo.getValue(),
        html: htmlContent,
      };
      if (input.templateId) {
        console.log(
          `[email-gateway] templateId=${input.templateId} templateVariables=${JSON.stringify(input.templateVariables)}`,
        );
      }
      const { data, error } = await resend.emails.send(payload);
      if (error) throw new Error(error.message);
      providerMessageId = data?.id || messageId;
      status = 'sent';
    }

    const response = {
      messageId: providerMessageId,
      status: status as EmailSendResponse['status'],
      recipientCount: recipients.length,
      sentAt: new Date().toISOString(),
      provider: resend ? 'resend' : 'mock',
      recipient: recipients,
    };

    await this.store.save({
      ...response,
      createdAt: new Date().toISOString(),
    });

    return response;
  }
}
