// Inbound delivery-status callbacks from email and SMS providers (ADR-0010). Each provider gets one
// normalizer: it verifies the provider's signature and turns the provider's callback into APICenter's
// delivery event. Adding a provider means adding a normalizer; the controller and runtimes stay the same.
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ServiceUnavailableError, UnauthorizedError, ValidationError } from '@shared/errors';
import type { ConfigService } from '@config/config.service';
import { verifyResendSignature, verifyTwilioSignature, twilioProviderEventId } from './delivery-webhook-signatures';

export type DeliveryEvent = { providerEventId: string; providerMessageId: string; status: string; payload: unknown };

export interface DeliveryStatusNormalizer {
  /** The runtime that owns the message. */
  readonly serviceId: 'email' | 'sms';
  /** Verifies the callback and returns its event, or null for a verified callback APICenter does not track. */
  normalize(req: RawBodyRequest<Request>, config: ConfigService): DeliveryEvent | null;
}

function header(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

const EMAIL_STATUSES = ['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed', 'opened', 'clicked'];
const SMS_STATUSES = ['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read', 'canceled'];

const resend: DeliveryStatusNormalizer = {
  serviceId: 'email',
  normalize(req, config) {
    const secret = config.deliveryWebhooks.resendWebhookSecret;
    if (!secret) throw new ServiceUnavailableError('RESEND_WEBHOOK_SECRET is not configured');
    const headers = { id: header(req, 'svix-id'), timestamp: header(req, 'svix-timestamp'), signature: header(req, 'svix-signature') };
    if (!req.rawBody || !headers.id || !headers.timestamp || !headers.signature) {
      throw new UnauthorizedError('Invalid Resend webhook signature');
    }
    let event: any;
    try {
      event = verifyResendSignature(secret, req.rawBody, headers);
    } catch {
      throw new UnauthorizedError('Invalid Resend webhook signature');
    }
    const type = typeof event?.type === 'string' && event.type.startsWith('email.')
      ? event.type.slice('email.'.length).replaceAll('.', '_') : '';
    const providerMessageId = event?.data?.email_id;
    if (!EMAIL_STATUSES.includes(type) || typeof providerMessageId !== 'string' || !providerMessageId) return null;
    return { providerEventId: headers.id, providerMessageId, status: type, payload: event };
  },
};

const twilio: DeliveryStatusNormalizer = {
  serviceId: 'sms',
  normalize(req, config) {
    const authToken = config.deliveryWebhooks.twilioAuthToken;
    const callbackUrl = config.deliveryWebhooks.twilioStatusCallbackUrl;
    if (!authToken || !callbackUrl) throw new ServiceUnavailableError('Twilio webhook validation is not configured');
    const signature = header(req, 'x-twilio-signature');
    const params = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const url = new URL(req.originalUrl || '/api/v1/webhooks/twilio', callbackUrl).toString();
    if (!signature || !verifyTwilioSignature(authToken, signature, url, params)) {
      throw new UnauthorizedError('Invalid Twilio webhook signature');
    }
    const providerMessageId = params.MessageSid;
    const status = params.MessageStatus;
    if (typeof providerMessageId !== 'string' || !providerMessageId || typeof status !== 'string' || !SMS_STATUSES.includes(status)) {
      throw new ValidationError('Twilio status callback is missing a valid message SID or status');
    }
    return { providerEventId: twilioProviderEventId(params), providerMessageId, status, payload: params };
  },
};

export const DELIVERY_STATUS_NORMALIZERS: Readonly<Record<string, DeliveryStatusNormalizer>> = { resend, twilio };
