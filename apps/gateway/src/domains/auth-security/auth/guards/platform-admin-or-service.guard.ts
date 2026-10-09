import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import type { AuthenticatedRequest } from "../../../../types";

type PlatformAdminOrServiceRequest = AuthenticatedRequest & {
  platformAdmin?: boolean;
};

@Injectable()
export class PlatformAdminOrServiceGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly admin: ScopedAdminGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAdminOrServiceRequest>();
    if (request.headers["x-platform-secret"]) {
      try {
        const allowed = await this.admin.canActivate(context);
        if (allowed) {
          request.platformAdmin = true;
          return true;
        }
      } catch {
        // A bad admin secret may accompany a valid service JWT.
      }
    }
    return this.jwt.canActivate(context);
  }
}
