import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "@auth/auth.service";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ForbiddenError } from "@shared/errors";
import { AuthenticatedRequest } from "../../../types";
import { PublishServiceSpecDto } from "./service-spec.dto";
import { ServiceSpecService } from "./service-spec.service";
import { ServiceSpecPublishGuard } from "./service-spec-publish.guard";

@Controller("admin/catalog/services/:serviceId/spec-versions")
export class ServiceSpecController {
  constructor(
    private readonly specs: ServiceSpecService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @UseGuards(ServiceSpecPublishGuard)
  async publish(
    @Param("serviceId") serviceId: string,
    @Body() body: PublishServiceSpecDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const scopes = this.auth.mergeCallerScopes(request.user ?? {});
    const isAdmin =
      scopes.includes("platform:admin") ||
      Boolean(
        (request as AuthenticatedRequest & { serviceSpecAdmin?: boolean })
          .serviceSpecAdmin,
      );
    const isOwner = request.sourceServiceId === serviceId;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenError(
        "Only a platform admin or the service itself may publish its specification",
      );
    }
    const published = await this.specs.publish(
      serviceId,
      request.user?.sub ?? request.sourceServiceId ?? "unknown",
      body,
    );
    return { success: true, data: published };
  }

  @Get()
  @UseGuards(ScopedAdminGuard)
  async list(@Param("serviceId") serviceId: string) {
    return { success: true, data: await this.specs.list(serviceId) };
  }

  @Get("latest")
  @UseGuards(ScopedAdminGuard)
  async latest(@Param("serviceId") serviceId: string) {
    return { success: true, data: await this.specs.get(serviceId) };
  }

  @Get(":version")
  @UseGuards(ScopedAdminGuard)
  async version(
    @Param("serviceId") serviceId: string,
    @Param("version") version: string,
  ) {
    return { success: true, data: await this.specs.get(serviceId, version) };
  }
}
