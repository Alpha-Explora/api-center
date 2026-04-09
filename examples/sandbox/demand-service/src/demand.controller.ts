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
      const message = (error as Error).message || 'Gateway request failed';
      const statusMatch = message.match(/status\s+(\d{3})/i);
      const status = statusMatch
        ? Number(statusMatch[1])
        : HttpStatus.BAD_GATEWAY;

      throw new HttpException(
        {
          message,
          source: 'demand-service',
        },
        status,
      );
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
      const message = (error as Error).message || 'Gateway request failed';
      const statusMatch = message.match(/status\s+(\d{3})/i);
      const status = statusMatch
        ? Number(statusMatch[1])
        : HttpStatus.BAD_GATEWAY;

      throw new HttpException(
        {
          message,
          source: 'demand-service',
        },
        status,
      );
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
      const message = (error as Error).message || 'Gateway request failed';
      const statusMatch = message.match(/status\s+(\d{3})/i);
      const status = statusMatch
        ? Number(statusMatch[1])
        : HttpStatus.BAD_GATEWAY;

      throw new HttpException(
        {
          message,
          source: 'demand-service',
        },
        status,
      );
    }
  }
}
