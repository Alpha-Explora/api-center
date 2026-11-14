import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import type { AuthenticatedRequest } from "../../../types";
import { VerificationEvidenceService } from "./verification-evidence.service";

@Controller("admin/operations/verification")
export class VerificationEvidenceController {
  constructor(private readonly evidence: VerificationEvidenceService) {}

  @Post("runs")
  @UseGuards(ScopedAdminGuard)
  async requestRun(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.evidence.requestRun(
        body,
        request.user?.sub ?? "management",
      ),
    };
  }

  @Post("claim")
  @UseGuards(JwtAuthGuard)
  async claim(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return {
      success: true,
      data: await this.evidence.claim(body, {
        subject: request.user?.sub ?? "",
        environment: request.user?.environment,
        scopes: [
          ...(request.user?.scopes ?? []),
          ...(request.user?.permissions ?? []),
        ],
      }),
    };
  }

  @Post("reconcile")
  @UseGuards(ScopedAdminGuard)
  async reconcile(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return {
      success: true,
      data: await this.evidence.reconcile(
        body,
        request.user?.sub ?? "management",
      ),
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async submit(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return {
      success: true,
      data: await this.evidence.record(body, {
        subject: request.user?.sub ?? "",
        environment: request.user?.environment,
        scopes: [
          ...(request.user?.scopes ?? []),
          ...(request.user?.permissions ?? []),
        ],
      }),
    };
  }

  @Get(":serviceId")
  @UseGuards(ScopedAdminGuard)
  async latest(
    @Param("serviceId") serviceId: string,
    @Query("environment") environment: string,
  ) {
    if (environment !== "test" && environment !== "live")
      throw new BadRequestException("Environment must be test or live");
    return {
      success: true,
      data: await this.evidence.latest(serviceId, environment),
    };
  }
}
