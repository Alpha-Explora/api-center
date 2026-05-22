import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import {
  parsePipelineHealthEnvironment,
  parsePipelinePartitionDate,
} from "./pipeline-health.dto";
import { DecisionSignalsService } from "./decision-signals.service";

@Controller("data-pipeline")
@UseGuards(ScopedAdminGuard)
export class DecisionSignalsController {
  constructor(private readonly decisionSignals: DecisionSignalsService) {}

  @Get("decision-signals")
  async getDecisionSignals(
    @Query("environment") environmentParam: string | undefined,
    @Query("year") year: string | undefined,
    @Query("month") month: string | undefined,
    @Query("day") day: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const data = await this.decisionSignals.listSignals(environment, partition);

    return {
      success: true,
      data,
      meta: {
        environment,
        partition,
        source: this.decisionSignals.getResponseSource(),
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }
}
