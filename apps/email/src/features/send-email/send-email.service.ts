import { Resend } from "resend";
import type { EmailSendRequest, EmailSendResponse } from "@alpha-explora/apicenter-contracts";
import type { SharedServiceCaller } from "@apicenter/runtime";
import { EmailRecipients, EmailSubject } from "./send-email.model";
import { createEmailStore } from "../../shared/email-store";

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM_ADDRESS;
const configuredDailyLimit = Number(process.env.EMAIL_DAILY_LIMIT_DEFAULT ?? 500);
if (!Number.isSafeInteger(configuredDailyLimit) || configuredDailyLimit < 1) {
  throw new Error("EMAIL_DAILY_LIMIT_DEFAULT must be a positive integer");
}
const defaultDailyLimit = configuredDailyLimit;
const nodeEnv = process.env.NODE_ENV || "development";
const resend = resendApiKey ? new Resend(resendApiKey) : null;

export class SendEmailService {
  constructor(private readonly store = createEmailStore()) {}

  async execute(
    input: EmailSendRequest,
    owner: SharedServiceCaller,
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
        provider: resend ? "resend" : "mock",
        recipients,
      },
      async (approvedFrom) => {
        if (!resend) return undefined;
        const content =
          input.html !== undefined && input.text !== undefined
            ? { html: input.html, text: input.text }
            : input.html !== undefined
              ? { html: input.html }
              : input.text !== undefined
                ? { text: input.text }
                : { html: "<p>(no content)</p>" };
        const payload = {
          from: approvedFrom,
          to: recipients,
          subject: subjectVo.getValue(),
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
