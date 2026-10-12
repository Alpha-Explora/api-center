import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiCenter } from '@alpha-explora/apicenter-sdk';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);

  private resolveCorrelationId(incomingCorrelationId?: string): string {
    return incomingCorrelationId || randomUUID();
  }

  private get gatewayUrl(): string {
    return (process.env.APICENTER_URL || 'http://nginx').replace(/\/+$/, '');
  }

  private get serviceCredentials() {
    return {
      serviceId: process.env.APICENTER_SERVICE_ID || 'demand-service',
      environment: process.env.APICENTER_ENVIRONMENT === 'live' ? 'live' as const : 'test' as const,
      secret: process.env.APICENTER_SERVICE_SECRET || 'demand-secret',
    };
  }

  private createClient(correlationId: string): ApiCenter {
    return new ApiCenter({
      baseUrl: this.gatewayUrl,
      auth: { getAccessToken: () => this.issueServiceToken(correlationId) },
    });
  }

  private async issueServiceToken(correlationId: string): Promise<string> {
    const response = await fetch(`${this.gatewayUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(this.serviceCredentials),
    });
    const payload = await this.readJson<ApiEnvelope<{ accessToken?: string }>>(response);
    if (!response.ok || payload.success !== true || !payload.data?.accessToken) {
      throw new Error(`APICenter service authentication failed (${response.status})`);
    }
    return payload.data.accessToken;
  }

  private async callTribeService<T>(
    serviceId: string,
    path: string,
    correlationId: string,
  ): Promise<T> {
    const token = await this.issueServiceToken(correlationId);
    const response = await fetch(
      `${this.gatewayUrl}/api/v1/tribes/${encodeURIComponent(serviceId)}${path}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Correlation-ID': correlationId,
        },
      },
    );
    const payload = await this.readJson<ApiEnvelope<T> | T>(response);
    if (!response.ok) throw new Error(`APICenter service request failed (${response.status})`);
    if (payload && typeof payload === 'object' && 'success' in payload && payload.success === true && 'data' in payload) {
      return payload.data as T;
    }
    return payload as T;
  }

  private async readJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new Error(`APICenter returned invalid JSON (${response.status})`);
    }
  }

  async fetchShipment(shipmentId: string, incomingCorrelationId?: string) {
    const correlationId = this.resolveCorrelationId(incomingCorrelationId);
    const shipment = await this.callTribeService<Record<string, unknown>>(
      'logistics-service',
      `/shipments/${encodeURIComponent(shipmentId)}`,
      correlationId,
    );

    this.logger.log(JSON.stringify({ event: 'demand_request', shipmentId, correlationId }));
    return { demandService: 'ok', shipment, correlationId };
  }

  async fetchShipmentWithGeoContext(
    shipmentId: string,
    ip?: string,
    incomingCorrelationId?: string,
  ) {
    const correlationId = this.resolveCorrelationId(incomingCorrelationId);
    const shipment = await this.callTribeService<Record<string, unknown>>(
      'logistics-service',
      `/shipments/${encodeURIComponent(shipmentId)}`,
      correlationId,
    );
    const api = this.createClient(correlationId);
    const requestOptions = { headers: { 'X-Correlation-ID': correlationId } };
    const resolvedIp = (ip || '').trim() || undefined;
    const latitude = 13.7563;
    const longitude = 100.5018;

    const fence = await api.geo.checkFence({
      latitude,
      longitude,
      fences: [{ fenceId: 'bangkok-demo', latitude, longitude, radiusMeters: 5000 }],
    }, requestOptions);
    const reverseGeocode = await api.geo.reverseGeocode({ latitude, longitude }, requestOptions);

    this.logger.log(JSON.stringify({
      event: 'demand_geo_context', shipmentId, ip: resolvedIp, latitude, longitude, correlationId,
    }));
    return { demandService: 'ok', shipment, geoContext: { fence, reverseGeocode }, correlationId };
  }

  async publishDemandEvent(
    _shipmentId: string,
    _options?: { clusterId?: string; topicSuffix?: string; eventType?: string; metadata?: Record<string, unknown> },
    _incomingCorrelationId?: string,
  ): Promise<never> {
    throw new NotImplementedException(
      'The current APICenter SDK does not expose Kafka event publishing. Use the platform-managed event integration.',
    );
  }
}
