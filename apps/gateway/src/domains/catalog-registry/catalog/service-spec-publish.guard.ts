import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { AuthenticatedRequest } from "../../../types";

type ServiceSpecPublishRequest = AuthenticatedRequest & {
  serviceSpecAdmin?: boolean;
};

@Injectable()
export class ServiceSpecPublishGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly admin: ScopedAdminGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ServiceSpecPublishRequest>();
    if (request.headers["x-platform-secret"]) {
      try {
        const allowed = await this.admin.canActivate(context);
        if (allowed) {
          request.serviceSpecAdmin = true;
          return true;
        }
      } catch {
        // A bad admin secret may accompany a valid service JWT; validate that next.
      }
    }
    return this.jwt.canActivate(context);
  }
}
