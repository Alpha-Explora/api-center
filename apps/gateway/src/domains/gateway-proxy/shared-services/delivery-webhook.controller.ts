import { Controller, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BadGatewayError, NotFoundError, ServiceUnavailableError, UnauthorizedError, ValidationError } from '@shared/errors';
import { ConfigService } from '@config/config.service';
import { RegistryService } from '@registry/registry.service';
import { getCloudRunAuthorizationHeader } from '@shared/proxy/cloud-run-auth';
import { verifyResendSignature, verifyTwilioSignature, twilioProviderEventId } from './delivery-webhook-signatures';

type EventPayload = { providerEventId: string; messageId: string; status: string; payload: unknown };

@Controller('webhooks')
export class DeliveryWebhookController {
  constructor(private readonly registry: RegistryService, private readonly config: ConfigService) {}

  @Post('resend')
  @HttpCode(200)
  async resend(@Req() req: RawBodyRequest<Request>) {
    const secret = this.config.deliveryWebhooks.resendWebhookSecret;
    if (!secret) throw new ServiceUnavailableError('RESEND_WEBHOOK_SECRET is not configured');
    const rawBody = req.rawBody;
    const headers = {
      id: header(req, 'svix-id'),
      timestamp: header(req, 'svix-timestamp'),
      signature: header(req, 'svix-signature'),
    };
    if (!rawBody || !headers.id || !headers.timestamp || !headers.signature) {
      throw new UnauthorizedError('Invalid Resend webhook signature');
    }
    let event: any;
    try {
      event = verifyResendSignature(secret, rawBody, headers);
    } catch {
      throw new UnauthorizedError('Invalid Resend webhook signature');
    }
    const status = resendStatus(event?.type);
    const messageId = event?.data?.email_id;
    if (!status || typeof messageId !== 'string' || !messageId) return { received: true, ignored: true };
    const deliveryEvent: EventPayload = {
      providerEventId: headers.id,
      messageId,
      status,
      payload: event,
    };
    return this.forward('email', 'resend', deliveryEvent);
  }

  @Post('twilio')
  @HttpCode(200)
  async twilio(@Req() req: RawBodyRequest<Request>) {
    const authToken = this.config.deliveryWebhooks.twilioAuthToken;
    const callbackUrl = this.config.deliveryWebhooks.twilioStatusCallbackUrl;
    if (!authToken || !callbackUrl) throw new ServiceUnavailableError('Twilio webhook validation is not configured');
    const signature = header(req, 'x-twilio-signature');
    const params = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const url = new URL(req.originalUrl || '/api/v1/webhooks/twilio', callbackUrl).toString();
    if (!signature || !verifyTwilioSignature(authToken, signature, url, params)) {
      throw new UnauthorizedError('Invalid Twilio webhook signature');
    }
    const messageId = params.MessageSid;
    const status = twilioStatus(params.MessageStatus);
    if (typeof messageId !== 'string' || !messageId || !status) {
      throw new ValidationError('Twilio status callback is missing a valid message SID or status');
    }
    return this.forward('sms', 'twilio', {
      providerEventId: twilioProviderEventId(params),
      messageId,
      status,
      payload: params,
    });
  }

  private async forward(serviceId: 'email' | 'sms', provider: 'resend' | 'twilio', event: EventPayload) {
    const upstream = this.registry.get(serviceId)?.environments
      .find((environment) => environment.environment === 'live')?.baseUrl?.replace(/\/+$/, '');
    if (!upstream) throw new NotFoundError(`${serviceId} runtime is not configured`);
    const authorization = await getCloudRunAuthorizationHeader(upstream);
    let response: globalThis.Response;
    try {
      response = await fetch(`${upstream}/webhooks/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        body: JSON.stringify(event),
      });
    } catch {
      throw new BadGatewayError(`${serviceId} webhook runtime is unavailable`);
    }
    if (!response.ok) {
      if (response.status >= 500) throw new BadGatewayError(`${serviceId} runtime rejected a verified delivery event`);
      throw new ValidationError(`${serviceId} runtime rejected a verified delivery event`);
    }
    const text = await response.text();
    if (!text) return { received: true };
    try { return JSON.parse(text); } catch { return { received: true }; }
  }
}

function header(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function resendStatus(eventType: unknown): EventPayload['status'] | null {
  if (typeof eventType !== 'string' || !eventType.startsWith('email.')) return null;
  const status = eventType.slice('email.'.length).replaceAll('.', '_');
  return ['sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed', 'opened', 'clicked'].includes(status)
    ? status
    : null;
}

function twilioStatus(value: unknown): EventPayload['status'] | null {
  return typeof value === 'string' && ['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'read', 'canceled'].includes(value)
    ? value
    : null;
}
