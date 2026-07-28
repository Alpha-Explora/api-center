import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import {
  parsePipelineHealthEnvironment,
  parsePipelinePartitionDate,
  parsePipelineWindowDays,
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
    @Query("windowDays") windowDaysParam: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = parsePipelineHealthEnvironment(environmentParam);
    const partition = parsePipelinePartitionDate(year, month, day);
    const windowDays = parsePipelineWindowDays(windowDaysParam);
    const data = await this.decisionSignals.listSignals(
      environment,
      partition,
      windowDays,
    );

    return {
      success: true,
      data,
      meta: {
        environment,
        partition,
        windowDays,
        source: this.decisionSignals.getResponseSource(),
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }
}
