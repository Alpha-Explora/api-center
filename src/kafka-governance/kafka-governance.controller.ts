import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { ForbiddenError } from '../shared/errors';
import { AuthenticatedRequest } from '../types';
import { KafkaPublishMessageDto } from './dto/kafka-publish-message.dto';
import { KafkaGovernanceService } from './kafka-governance.service';

@Controller('kafka')
@UseGuards(JwtAuthGuard)
export class KafkaGovernanceController {
  constructor(
    private readonly kafkaGovernance: KafkaGovernanceService,
    private readonly auth: AuthService,
  ) {}

  @Get('governance')
  getGovernanceCatalog(@Req() req: AuthenticatedRequest) {
    const tribeId = this.resolveTribeId(req);
    this.ensureScopes(req, ['external:kafka:read']);

    return {
      success: true,
      data: this.kafkaGovernance.getGovernanceCatalog(tribeId),
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
      },
    };
  }

  @Get('schemas')
  getSchemaCatalog(@Req() req: AuthenticatedRequest) {
    const tribeId = this.resolveTribeId(req);
    this.ensureScopes(req, ['external:kafka:read']);

    return {
      success: true,
      data: this.kafkaGovernance.getSchemaCatalog(),
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
      },
    };
  }

  @Post('publish')
  async publishMessage(
    @Body() dto: KafkaPublishMessageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const tribeId = this.resolveTribeId(req);
    this.ensureScopes(req, ['external:kafka:write']);

    const result = await this.kafkaGovernance.publishMessage(
      tribeId,
      dto,
      req.correlationId,
    );

    return {
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
      },
    };
  }

  private resolveTribeId(req: AuthenticatedRequest): string {
    const tribeId = req.user?.tribeId ?? req.tribeId;
    if (!tribeId) {
      throw new ForbiddenError('Kafka governance requires a token with tribeId claim');
    }

    return tribeId;
  }

  private ensureScopes(req: AuthenticatedRequest, requiredScopes: string[]): void {
    const missingScopes = this.auth.checkScopes(req, requiredScopes);
    if (missingScopes.length > 0) {
      throw new ForbiddenError(`Missing required scopes: ${missingScopes.join(', ')}`);
    }
  }
}
