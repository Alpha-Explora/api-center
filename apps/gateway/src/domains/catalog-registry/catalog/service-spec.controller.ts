import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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

@Controller("admin/catalog/services/:serviceIdentity/spec-versions")
export class ServiceSpecController {
  constructor(
    private readonly specs: ServiceSpecService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @UseGuards(ServiceSpecPublishGuard)
  async publish(
    @Param("serviceIdentity", new ParseUUIDPipe()) serviceIdentity: string,
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
    if (!isAdmin && (!request.sourceServiceId || !request.projectId)) {
      throw new ForbiddenError(
        "Only a platform admin or an authenticated project service may publish its specification",
      );
    }
    const published = await this.specs.publish(
      serviceIdentity,
      request.user?.sub ?? request.sourceServiceId ?? "unknown",
      body,
      isAdmin
        ? undefined
        : {
            serviceId: request.sourceServiceId!,
            projectId: request.projectId!,
          },
    );
    return { success: true, data: published };
  }

  @Get()
  @UseGuards(ScopedAdminGuard)
  async list(
    @Param("serviceIdentity", new ParseUUIDPipe()) serviceIdentity: string,
  ) {
    return { success: true, data: await this.specs.list(serviceIdentity) };
  }

  @Get("latest")
  @UseGuards(ScopedAdminGuard)
  async latest(
    @Param("serviceIdentity", new ParseUUIDPipe()) serviceIdentity: string,
  ) {
    return { success: true, data: await this.specs.get(serviceIdentity) };
  }

  @Get(":version")
  @UseGuards(ScopedAdminGuard)
  async version(
    @Param("serviceIdentity", new ParseUUIDPipe()) serviceIdentity: string,
    @Param("version") version: string,
  ) {
    return {
      success: true,
      data: await this.specs.get(serviceIdentity, version),
    };
  }
}

@Controller("admin/catalog/service-specs")
@UseGuards(ScopedAdminGuard)
export class ServiceSpecCatalogController {
  constructor(private readonly specs: ServiceSpecService) {}

  @Get()
  async listServices() {
    return { success: true, data: await this.specs.listCatalogServices() };
  }
}
