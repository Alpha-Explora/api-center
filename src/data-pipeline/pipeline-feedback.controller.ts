import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import { parsePipelineHealthEnvironment } from "./pipeline-health.dto";
import {
  PipelineFeedbackActionDto,
  PipelineFeedbackTargetType,
} from "./pipeline-feedback.dto";
import { PipelineFeedbackService } from "./pipeline-feedback.service";

@Controller("data-pipeline")
@UseGuards(ScopedAdminGuard)
export class PipelineFeedbackController {
  constructor(private readonly feedback: PipelineFeedbackService) {}

  @Post("feedback-actions")
  async create(
    @Body() dto: PipelineFeedbackActionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const record = await this.feedback.createFeedbackAction(dto, {
      actorId: req.user?.sub ?? "platform-admin",
      actorRole: this.resolveActorRole(req),
      correlationId: req.correlationId,
    });

    return this.response(record, req.correlationId);
  }

  @Get("feedback-actions")
  async list(
    @Query("environment") environmentParam: string | undefined,
    @Query("targetId") targetId: string | undefined,
    @Query("targetType") targetType: PipelineFeedbackTargetType | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const environment = environmentParam
      ? parsePipelineHealthEnvironment(environmentParam)
      : undefined;
    const records = await this.feedback.listFeedbackActions({
      environment,
      targetId,
      targetType,
    });

    return this.response(records, req.correlationId, { total: records.length });
  }

  private response(
    data: unknown,
    correlationId?: string,
    meta: Record<string, unknown> = {},
  ) {
    return {
      success: true,
      data,
      meta: {
        ...meta,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    };
  }

  private resolveActorRole(req: AuthenticatedRequest): string {
    if (req.user?.scopes?.includes("platform:admin")) return "platform-admin";
    return "platform-admin";
  }
}
