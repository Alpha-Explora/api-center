import { Resend } from "resend";
import type { EmailSendRequest, EmailSendResponse } from "@alpha-explora/apicenter-contracts";
import { formatSender, type SharedServiceCaller } from "@apicenter/runtime";
import { EmailRecipients, EmailSubject } from "./send-email.model";
import { createEmailStore } from "../../shared/email-store";

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM_ADDRESS;
const configuredDailyLimit = Number(process.env.EMAIL_DAILY_LIMIT_DEFAULT ?? 500);
if (!Number.isSafeInteger(configuredDailyLimit) || configuredDailyLimit < 1) {
  throw new Error("EMAIL_DAILY_LIMIT_DEFAULT must be a positive integer");
}
export const defaultDailyLimit = configuredDailyLimit;
const nodeEnv = process.env.NODE_ENV || "development";
const resend = resendApiKey ? new Resend(resendApiKey) : null;

export class SendEmailService {
  constructor(private readonly store = createEmailStore()) {}

  /** `options` presents platform messages: a sender name in front of the address, and a reply-to. */
  async execute(
    input: EmailSendRequest,
    owner: SharedServiceCaller,
    options: { fromName?: string; replyTo?: string } = {},
  ): Promise<EmailSendResponse & { provider: string; recipient: string[] }> {
    const recipientsVo = new EmailRecipients(input.to);
    const subjectVo = new EmailSubject(input.subject);

    const recipients = recipientsVo.getRecipients();
    if ((!resend || !emailFrom) && nodeEnv === "production") {
      throw new Error(
        "Resend API key and sender address are required in production",
      );
    }

    if (resend && !emailFrom) throw new Error("Resend sender address is required");
    const record = await this.store.sendWithinDailyLimit(
      owner,
      {
        requestedFrom: input.from,
        defaultFrom: emailFrom || "no-reply@example.test",
        defaultDailyLimit,
        provider: owner.suppressDelivery ? "suppressed" : resend ? "resend" : "mock",
        recipients,
      },
      async (approvedFrom) => {
        // A test send to an unregistered recipient is recorded but never reaches the provider.
        if (!resend || owner.suppressDelivery) return undefined;
        const content =
          input.html !== undefined && input.text !== undefined
            ? { html: input.html, text: input.text }
            : input.html !== undefined
              ? { html: input.html }
              : input.text !== undefined
                ? { text: input.text }
                : { html: "<p>(no content)</p>" };
        const payload = {
          from: formatSender(approvedFrom, options.fromName),
          to: recipients,
          subject: subjectVo.getValue(),
          ...(options.replyTo ? { replyTo: options.replyTo } : {}),
          ...content,
        };
        const { data, error } = await resend.emails.send(payload);
        if (error) throw new Error(error.message);
        return data?.id || undefined;
      },
    );

    return {
      messageId: record.messageId,
      status: record.status as EmailSendResponse['status'],
      recipientCount: recipients.length,
      sentAt: record.sentAt,
      provider: record.provider,
      recipient: record.recipient,
    };
  }
}
