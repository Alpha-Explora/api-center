import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { AuthenticatedRequest, isApicenterRuntimeEnvironment } from "../../../types";
import { RegistryService } from "@registry/registry.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { PaymentApiKeyService } from "../features/payment-facade/payment-api-key.service";
import { normalizePaymentServiceScopes } from "./payment-service-scopes";

@Injectable()
export class PaymentAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: PaymentApiKeyService,
    private readonly jwt: JwtAuthGuard,
    private readonly registry: RegistryService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
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

    if (!(await this.jwt.canActivate(context))) return false;

    // Service JWT claims are signed, but placement and lifecycle can change after
    // issuance. Re-check the caller against the current registry and tenancy state;
    // never accept project, tribe, or environment from request headers or body.
    const authenticated = request as AuthenticatedRequest;
    const claims = authenticated.user;
    const serviceId = claims?.sourceServiceId ?? claims?.sub;
    const environment = claims?.environment;
    if (
      !claims ||
      !serviceId ||
      (claims.sourceServiceId && claims.sourceServiceId !== claims.sub) ||
      !claims.projectId ||
      !claims.tribeId ||
      !isApicenterRuntimeEnvironment(environment)
    ) {
      throw new ForbiddenException("Payment access requires a placed service identity and runtime environment");
    }

    const service = this.registry.get(serviceId);
    const paymentService = this.registry.get("payment");
    const placement = this.tenancy.resolveServicePlacement(serviceId);
    const projectPlacement = this.tenancy.resolveProject(claims.projectId);
    const serviceEnvironment = service?.environments.find(
      (candidate) => candidate.environment === environment,
    );
    const paymentEnvironment = paymentService?.environments.find(
      (candidate) => candidate.environment === environment,
    );
    if (
      !service ||
      service.status !== "active" ||
      (service.serviceType ?? "tribe") !== "tribe" ||
      !placement ||
      placement.projectId !== claims.projectId ||
      placement.tribeId !== claims.tribeId ||
      service.projectId !== claims.projectId ||
      service.ownerTribeId !== claims.tribeId ||
      !projectPlacement ||
      projectPlacement.project.projectId !== claims.projectId ||
      projectPlacement.project.tribeId !== claims.tribeId ||
      projectPlacement.tribe.tribeId !== claims.tribeId ||
      projectPlacement.project.status !== "active" ||
      projectPlacement.tribe.status !== "active" ||
      !serviceEnvironment ||
      serviceEnvironment.status !== "active" ||
      !paymentService ||
      paymentService.status !== "active" ||
      paymentService.serviceType !== "shared" ||
      !paymentEnvironment ||
      paymentEnvironment.status !== "active" ||
      !this.registry.canAccess(serviceId, "payment", environment)
    ) {
      throw new ForbiddenException("Service is not currently authorized for payments in this environment");
    }

    const scopes = normalizePaymentServiceScopes([
      ...(Array.isArray(claims.scopes) ? claims.scopes : []),
      ...(Array.isArray(claims.permissions) ? claims.permissions : []),
    ].filter((scope): scope is string => typeof scope === "string"));
    authenticated.paymentPrincipal = {
      ownerTribeId: claims.tribeId,
      projectId: claims.projectId,
      consumerServiceId: serviceId,
      environment,
      scopes,
    };
    return true;
  }

  private bearerToken(request: Request): string | undefined {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
  }
}
