import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../types";
import {
  CreateRegistrationRequestDto,
  RejectRegistrationRequestDto,
} from "./registration-request.dto";
import {
  RegistrationRequestsService,
  ServiceRegistrationRequest,
} from "./registration-requests.service";
import { ServiceManifest, ServiceTier, ServiceType } from "../types";

@Controller("registry/registration-requests")
@UseGuards(ScopedAdminGuard)
export class RegistrationRequestsController {
  constructor(private readonly requests: RegistrationRequestsService) {}

  @Post()
  async create(@Body() dto: CreateRegistrationRequestDto) {
    const request = await this.requests.createRequest({
      manifest: normalizeManifest(dto.manifest),
      requestedBy: dto.requestedBy,
    });

    return response(request);
  }

  @Get()
  async list(@Query("status") status?: "pending" | "rejected" | "applied") {
    const requests = await this.requests.listRequests(status);
    return response(requests, { total: requests.length });
  }

  @Post(":requestId/approve")
  async approve(
    @Param("requestId") requestId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const request = await this.requests.approveRequest(
      requestId,
      req.user?.sub ?? "platform-admin",
    );
    return response(request);
  }

  @Post(":requestId/reject")
  async reject(
    @Param("requestId") requestId: string,
    @Body() dto: RejectRegistrationRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const request = await this.requests.rejectRequest(
      requestId,
      req.user?.sub ?? "platform-admin",
      dto.reason,
    );
    return response(request);
  }
}

function response(
  data: ServiceRegistrationRequest | ServiceRegistrationRequest[],
  meta: Record<string, unknown> = {},
) {
  return {
    success: true,
    data,
    meta: {
      ...meta,
      timestamp: new Date().toISOString(),
    },
  };
}

function normalizeManifest(manifest: CreateRegistrationRequestDto["manifest"]): ServiceManifest {
  return {
    ...manifest,
    consumes: manifest.consumes ?? [],
    serviceTier: manifest.serviceTier as ServiceTier | undefined,
    serviceType: (manifest.serviceType ?? "tribe") as ServiceType,
  };
}
