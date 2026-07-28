import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import { TopicOnboardingStateService } from "./topic-onboarding-state.service";
import { TopicOnboardingStateUpsertDto } from "./topic-onboarding-state.dto";

@Controller("data-pipeline/topic-onboarding-states")
@UseGuards(ScopedAdminGuard)
export class TopicOnboardingStateController {
  constructor(private readonly states: TopicOnboardingStateService) {}

  @Get(":physicalTopic")
  async get(@Param("physicalTopic") physicalTopic: string) {
    const record = await this.states.get(physicalTopic);
    if (!record) {
      throw new NotFoundException("Topic onboarding state was not found.");
    }
    return { success: true, data: record };
  }

  @Put(":physicalTopic")
  @HttpCode(200)
  async upsert(
    @Param("physicalTopic") physicalTopic: string,
    @Body() dto: TopicOnboardingStateUpsertDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const record = await this.states.upsert(
      physicalTopic,
      dto.record,
      req.user?.sub,
      req.correlationId,
    );
    return { success: true, data: record };
  }
}
