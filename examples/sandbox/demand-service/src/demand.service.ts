import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TribeClient } from '@apicenter/sdk';

@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);

  private resolveCorrelationId(incomingCorrelationId?: string): string {
    return incomingCorrelationId || randomUUID();
  }

  private async createClient(correlationId: string): Promise<TribeClient> {
    const client = new TribeClient({
      gatewayUrl: process.env.APICENTER_URL || 'http://nginx',
      tribeId: process.env.DEMAND_TRIBE_ID || 'demand-service',
      secret: process.env.DEMAND_TRIBE_SECRET || 'demand-secret',
      correlationIdFactory: () => correlationId,
    });

    await client.authenticate();
    return client;
  }

  private extractClusterId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const direct = (payload as { cluster_id?: unknown }).cluster_id;
    if (typeof direct === 'string' && direct.length > 0) {
      return direct;
    }

    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const candidate = data.find(
      (entry) =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { cluster_id?: unknown }).cluster_id === 'string',
    ) as { cluster_id?: string } | undefined;

    return candidate?.cluster_id ?? null;
  }

  async fetchShipment(shipmentId: string, incomingCorrelationId?: string) {
    const correlationId = this.resolveCorrelationId(incomingCorrelationId);
    const client = await this.createClient(correlationId);

    const shipment = await client.callService<Record<string, unknown>>(
      'logistics-service',
      `/shipments/${encodeURIComponent(shipmentId)}`,
    );

    this.logger.log(
      JSON.stringify({
        event: 'demand_request',
        shipmentId,
        correlationId,
      }),
    );

    return {
      demandService: 'ok',
      shipment,
      correlationId,
    };
  }

  async fetchShipmentWithGeoContext(
    shipmentId: string,
    ip?: string,
    incomingCorrelationId?: string,
  ) {
    const correlationId = this.resolveCorrelationId(incomingCorrelationId);
    const client = await this.createClient(correlationId);

    const shipment = await client.callService<Record<string, unknown>>(
      'logistics-service',
      `/shipments/${encodeURIComponent(shipmentId)}`,
    );

    const resolvedIp = (ip || '').trim() || '8.8.8.8';
    const geolocation = await client.geolocateIp<Record<string, unknown>>(resolvedIp);

    const latitude = Number((geolocation as { latitude?: unknown })?.latitude ?? 13.7563);
    const longitude = Number((geolocation as { longitude?: unknown })?.longitude ?? 100.5018);

    const geofencing = await client.geofenceCheck<Record<string, unknown>>({
      latitude,
      longitude,
    });

    const geotagging = await client.geotagResolve<Record<string, unknown>>({
      ip: resolvedIp,
      latitude,
      longitude,
      context: {
        shipmentId,
      },
    });

    this.logger.log(
      JSON.stringify({
        event: 'demand_geo_context',
        shipmentId,
        ip: resolvedIp,
        latitude,
        longitude,
        correlationId,
      }),
    );

    return {
      demandService: 'ok',
      shipment,
      geoContext: {
        geolocation,
        geofencing,
        geotagging,
      },
      correlationId,
    };
  }

  async publishDemandEvent(
    shipmentId: string,
    options?: {
      clusterId?: string;
      topicSuffix?: string;
      eventType?: string;
      metadata?: Record<string, unknown>;
    },
    incomingCorrelationId?: string,
  ) {
    const correlationId = this.resolveCorrelationId(incomingCorrelationId);
    const client = await this.createClient(correlationId);

    const clusterList = await client.kafkaListClusters<unknown>();
    const clusterId =
      options?.clusterId ||
      this.extractClusterId(clusterList) ||
      process.env.KAFKA_CLUSTER_ID ||
      '';

    if (!clusterId) {
      throw new Error(
        'No Kafka cluster id available. Provide clusterId in request body or set KAFKA_CLUSTER_ID.',
      );
    }

    const tribeId = process.env.DEMAND_TRIBE_ID || 'demand-service';
    const topic = TribeClient.buildTenantTopic(tribeId, options?.topicSuffix || 'events');

    const eventType = options?.eventType || 'demand.shipment.requested';
    const value = {
      eventType,
      shipmentId,
      tribeId,
      source: 'demand-service',
      correlationId,
      timestamp: new Date().toISOString(),
      metadata: options?.metadata || {},
    };

    const produceResult = await client.kafkaProduceRecords<Record<string, unknown>>(
      clusterId,
      topic,
      [
        {
          key: shipmentId,
          value,
          headers: {
            'x-correlation-id': correlationId,
            'x-tribe-id': tribeId,
          },
        },
      ],
    );

    this.logger.log(
      JSON.stringify({
        event: 'demand_kafka_publish',
        shipmentId,
        topic,
        clusterId,
        correlationId,
      }),
    );

    return {
      demandService: 'ok',
      published: true,
      clusterId,
      topic,
      produceResult,
      correlationId,
    };
  }
}
