import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DemandService } from './demand.service';

interface PublishDemandEventBody {
  clusterId?: string;
  topicSuffix?: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
}

@Controller()
export class DemandController {
  constructor(private readonly demand: DemandService) {}

  private extractStatusCode(error: unknown): number {
    const typed = error as {
      statusCode?: unknown;
      response?: {
        status?: unknown;
      };
    };

    if (typeof typed?.statusCode === 'number') {
      return typed.statusCode;
    }

    if (typeof typed?.response?.status === 'number') {
      return typed.response.status;
    }

    const getStatus = (error as { getStatus?: unknown } | undefined)?.getStatus;
    if (typeof getStatus === 'function') {
      const status = getStatus.call(error) as unknown;
      if (typeof status === 'number') return status;
    }

    const message =
      (error as { message?: string } | undefined)?.message ||
      'Gateway request failed';
    const statusMatch = /status\s+(\d{3})/i.exec(message);
    return statusMatch ? Number(statusMatch[1]) : HttpStatus.BAD_GATEWAY;
  }

  private throwMappedError(error: unknown): never {
    const message =
      (error as { message?: string } | undefined)?.message ||
      'Gateway request failed';

    throw new HttpException(
      {
        message,
        source: 'demand-service',
      },
      this.extractStatusCode(error),
    );
  }

  @Get('health')
  health() {
    return {
      ok: true,
      service: 'demand-service',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('demand/:id')
  async getDemandShipment(
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    try {
      return await this.demand.fetchShipment(id, correlationId);
    } catch (error) {
      this.throwMappedError(error);
    }
  }

  @Get('demand/:id/geo-context')
  async getDemandShipmentGeoContext(
    @Param('id') id: string,
    @Query('ip') ip?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    try {
      return await this.demand.fetchShipmentWithGeoContext(id, ip, correlationId);
    } catch (error) {
      this.throwMappedError(error);
    }
  }

  @Post('demand/:id/kafka-publish')
  async publishDemandEvent(
    @Param('id') id: string,
    @Body() body: PublishDemandEventBody,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    try {
      return await this.demand.publishDemandEvent(id, body, correlationId);
    } catch (error) {
      this.throwMappedError(error);
    }
  }
}
