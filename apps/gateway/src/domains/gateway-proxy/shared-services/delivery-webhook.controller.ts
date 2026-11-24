import { Controller, HttpCode, Param, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BadGatewayError, NotFoundError, ValidationError } from '@shared/errors';
import { ConfigService } from '@config/config.service';
import { SharedServiceRoutingService } from './shared-service-routing.service';
import { getCloudRunAuthorizationHeader } from '@shared/proxy/cloud-run-auth';
import { DELIVERY_STATUS_NORMALIZERS, type DeliveryEvent } from './delivery-status-normalizers';

/**
 * Provider delivery-status callbacks: POST /api/v1/webhooks/:provider. The provider's normalizer verifies
 * and translates the callback; the owning runtime receives APICenter's delivery event at /delivery-events.
 */
@Controller('webhooks')
export class DeliveryWebhookController {
  constructor(private readonly routing: SharedServiceRoutingService, private readonly config: ConfigService) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    const normalizer = Object.hasOwn(DELIVERY_STATUS_NORMALIZERS, provider) ? DELIVERY_STATUS_NORMALIZERS[provider] : undefined;
    if (!normalizer) throw new NotFoundError('Unknown delivery webhook provider');
    const event = normalizer.normalize(req, this.config);
    if (!event) return { received: true, ignored: true };
    return this.forward(normalizer.serviceId, provider, event);
  }

  private async forward(serviceId: 'email' | 'sms', provider: string, event: DeliveryEvent) {
    // Delivery events are provider callbacks; the runtime serves both environments.
    let upstream: string;
    try {
      upstream = this.routing.resolve(serviceId, 'live').targetUrl.replace(/\/+$/, '');
    } catch {
      throw new NotFoundError(`${serviceId} runtime is not configured`);
    }
    const authorization = await getCloudRunAuthorizationHeader(upstream);
    let response: globalThis.Response;
    try {
      response = await fetch(`${upstream}/delivery-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        // `messageId` is the provider's message ID; the runtime resolves it to APICenter's.
        body: JSON.stringify({ provider, providerEventId: event.providerEventId, messageId: event.providerMessageId,
          status: event.status, payload: event.payload }),
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
