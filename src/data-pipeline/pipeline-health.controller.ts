import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import {
  parsePipelineHealthEnvironment,
  parsePipelinePartitionDate,
} from "./pipeline-health.dto";
import { PipelineGovernanceService } from "./pipeline-governance.service";
import { PipelineHealthService } from "./pipeline-health.service";

@Controller("data-pipeline")
@UseGuards(ScopedAdminGuard)
export class PipelineHealthController {
  constructor(
    private readonly pipelineHealth: PipelineHealthService,
    private readonly pipelineGovernance: PipelineGovernanceService,
  ) {}

  @Get("health")
  async getHealth(
    @Query("environment") environmentParam: string | undefined,
    @Query("year") year: string | undefined,
    @Query("month") month: string | undefined,
    @Query("day") day: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const data = await this.pipelineHealth.listHealth(environment, partition);

    return {
      success: true,
      data,
      meta: {
        environment,
        partition,
        source: this.pipelineHealth.getResponseSource(),
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  @Get("quality")
  async getQuality(
    @Query("environment") environmentParam: string | undefined,
    @Query("year") year: string | undefined,
    @Query("month") month: string | undefined,
    @Query("day") day: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const data = await this.pipelineGovernance.listQuality(
      environment,
      partition,
    );

    return {
      success: true,
      data,
      meta: this.buildGovernanceMeta(environment, req, partition),
    };
  }

  @Get("shared-service-usage")
  async getSharedServiceUsage(
    @Query("environment") environmentParam: string | undefined,
    @Query("year") year: string | undefined,
    @Query("month") month: string | undefined,
    @Query("day") day: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const data = await this.pipelineGovernance.listSharedServiceUsage(
      environment,
      partition,
    );

    return {
      success: true,
      data,
      meta: this.buildGovernanceMeta(environment, req, partition),
    };
  }

  @Get("gateway-decisions")
  async getGatewayDecisions(
    @Query("environment") environmentParam: string | undefined,
    @Query("year") year: string | undefined,
    @Query("month") month: string | undefined,
    @Query("day") day: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const data = await this.pipelineGovernance.listGatewayDecisions(
      environment,
      partition,
    );

    return {
      success: true,
      data,
      meta: this.buildGovernanceMeta(environment, req, partition),
    };
  }

  @Get("cost")
  async getCost(
    @Query("environment") environmentParam: string | undefined,
    @Query("year") year: string | undefined,
    @Query("month") month: string | undefined,
    @Query("day") day: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const data = await this.pipelineGovernance.listCost(environment, partition);

    return {
      success: true,
      data,
      meta: this.buildGovernanceMeta(environment, req, partition),
    };
  }

  private buildGovernanceMeta(
    environment: ReturnType<typeof parsePipelineHealthEnvironment>,
    req: AuthenticatedRequest,
    partition: ReturnType<typeof parsePipelinePartitionDate>,
  ) {
    return {
      environment,
      partition,
      source: this.pipelineGovernance.getResponseSource(),
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
    };
  }
}
