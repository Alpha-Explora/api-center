// GET /api/v1/whoami: the application, project and environment an application key belongs to,
// and its grants. The SDK's startup check; it reads no tenant data beyond the key's own.
import { Controller, Get, Headers } from "@nestjs/common";
import { UnauthorizedError } from "@shared/errors";
import { ApplicationAccessService } from "./application-access.service";

@Controller("whoami")
export class WhoAmIController {
  constructor(private readonly access: ApplicationAccessService) {}

  @Get()
  async whoami(@Headers("authorization") authorization: string | undefined) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    if (!bearer) throw new UnauthorizedError("An application key is required (Authorization: Bearer ak_…)");
    return { success: true, data: await this.access.whoami(bearer) };
  }
}
