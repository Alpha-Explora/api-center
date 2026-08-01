import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { AuthenticatedRequest } from "../../../types";
import { PaymentApiKeyService } from "../features/payment-facade/payment-api-key.service";

@Injectable()
export class PaymentAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: PaymentApiKeyService,
    private readonly jwt: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.bearerToken(request);
    if (!token) throw new UnauthorizedException("Missing authorization token");

    if (token.startsWith("apic_")) {
      const principal = await this.apiKeys.resolve(token);
      if (!principal) throw new UnauthorizedException("Invalid or revoked payment API key");
      const authenticated = request as AuthenticatedRequest;
      authenticated.paymentPrincipal = principal;
      authenticated.tribeId = principal.ownerTribeId;
      authenticated.sourceServiceId = principal.consumerServiceId;
      authenticated.user = {
        sub: principal.consumerServiceId,
        tribeId: principal.ownerTribeId,
        sourceServiceId: principal.consumerServiceId,
        environment: principal.environment,
        scopes: principal.scopes,
      };
      return true;
    }

    return this.jwt.canActivate(context);
  }

  private bearerToken(request: Request): string | undefined {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
  }
}
