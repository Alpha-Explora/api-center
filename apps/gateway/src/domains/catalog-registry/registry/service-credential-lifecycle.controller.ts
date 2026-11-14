import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../../../types";
import { z } from "zod";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ServiceCredentialLifecycleService } from "./service-credential-lifecycle.service";

@Controller("admin/registry/service-credentials")
@UseGuards(ScopedAdminGuard)
export class ServiceCredentialLifecycleController {
  constructor(private readonly lifecycle: ServiceCredentialLifecycleService) {}
  @Post("rotation")
  async apply(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z.record(z.string(), z.unknown()).safeParse(body);
    const input =
      request.user?.sub && parsed.success
        ? { ...parsed.data, actor: request.user.sub }
        : body;
    return { success: true, data: await this.lifecycle.apply(input) };
  }
}
