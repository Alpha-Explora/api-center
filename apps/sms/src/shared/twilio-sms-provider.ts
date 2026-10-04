import { sendTwilioSms } from '@apicenter/runtime';

/** Describes an unsuccessful SMS provider request with its provider status. */
export class SmsProviderError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message);
  }
}

/** Sends SMS through Twilio and translates provider statuses into APICenter statuses. */
export class TwilioSmsProvider {
  async send(to: string, message: string, senderId?: string) {
    try {
      return await sendTwilioSms({ to, message, senderId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Twilio request failed';
      throw new SmsProviderError(message, message.includes('are required') ? 503 : 502);
    }
  }
}
