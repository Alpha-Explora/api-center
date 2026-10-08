// =============================================================================
// src/auth/auth.controller.ts - Token issuance, refresh, revocation + JWKS
// =============================================================================

import {
  Controller,
  Post,
  Get,
  Body,
  Inject,
  Req,
  Res,
  HttpCode,
  UseGuards,
  NotFoundException,
  HttpStatus,
} from "@nestjs/common";
import { ApiCreatedResponse } from "@nestjs/swagger";
import { Response } from "express";
import { AuthService, type ServiceTokenGrant } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RegistryService } from "@registry/registry.service";
import { TENANCY_DIRECTORY, type TenancyDirectory } from "@registry/tenancy.types";
import { LoggerService } from "@shared/logger.service";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@shared/errors";
import { TokenRequestDto } from "@shared/dto/token-request.dto";
import { TokenIssueResponseDto } from "@shared/dto/token-response.dto";
import { RefreshTokenDto } from "@shared/dto/refresh-token.dto";
import { RevokeTokenDto } from "@shared/dto/revoke-token.dto";
import { getPlatformCapabilityScopes } from "@shared/platform-capabilities";
import {
  ApicenterRuntimeEnvironment,
  AuthenticatedRequest,
  ServiceRegistryEntry,
} from "../../../types";
import { ConfigService } from "@config/config.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registry: RegistryService,
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/token - Issue an M2M JWT for one tribe service
  // ---------------------------------------------------------------------------

  @Post("token")
  @ApiCreatedResponse({ type: TokenIssueResponseDto })
  async issueToken(
    @Body() dto: TokenRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { serviceId, secret } = dto;
    const { environment } = this.resolveTokenEnvironment(dto.environment);
    const service = this.validateTokenService(serviceId, environment);
    const placement = this.resolvePlacement(service);

    const isValid = await this.registry.validateEnvironmentSecret(
      serviceId,
      secret,
      environment,
    );
    if (!isValid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const { identity, permissions, scopes } = this.buildGrant(serviceId, placement);

    const token = await this.auth.issueServiceToken(
      identity,
      permissions,
      scopes,
      environment,
    );

    this.logger.info("Token issued", {
      ...identity,
      environment,
      scopes,
      correlationId: req.correlationId,
    });

    return {
      success: true,
      data: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? null,
        expiresIn: token.expiresIn,
        ...identity,
        environment,
        permissions,
        scopes,
      },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/token/refresh - Refresh access token
  // ---------------------------------------------------------------------------

  @Post("token/refresh")
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @Req() req: AuthenticatedRequest,
  ) {
    // A refresh is a new grant: the service, project, and tribe must still be active, and scopes are
    // recomputed from the registry as it stands now.
    const resp = await this.auth.refreshToken(dto.refreshToken, (subject) => {
      const service = this.validateTokenService(subject.serviceId, subject.environment);
      const placement = this.resolvePlacement(service);
      if (placement.project.projectId !== subject.projectId) {
        throw new ForbiddenError(
          `Service '${subject.serviceId}' is no longer in project '${subject.projectId}'; request a new token`,
        );
      }
      return this.buildGrant(subject.serviceId, placement);
    });

    this.logger.info("Token refreshed", { correlationId: req.correlationId });

    return {
      success: true,
      data: {
        accessToken: resp.accessToken,
        refreshToken: resp.refreshToken ?? null,
        expiresIn: resp.expiresIn,
      },
      meta: {
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/token/revoke - Revoke refresh token
  // Requires a valid Bearer access token (JWT guard)
  // ---------------------------------------------------------------------------

  @Post("token/revoke")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeToken(
    @Body() dto: RevokeTokenDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const { revokedCount, sub } = await this.auth.revokeToken(
      dto.refreshToken,
      dto.revokeAll ?? false,
    );

    this.logger.info("Token(s) revoked", {
      sub,
      revokedCount,
      revokeAll: dto.revokeAll,
      correlationId: req.correlationId,
    });

    res.status(HttpStatus.NO_CONTENT).send();
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/.well-known/jwks.json - JWKS for API Center-signed tokens
  // ---------------------------------------------------------------------------

  @Get(".well-known/jwks.json")
  getJwks() {
    const jwks = this.auth.getJwksJson();
    if (!jwks) {
      const providerName = this.config.authProvider;
      const providerJwksUrl =
        process.env.DESCOPE_JWKS_URI || "<PROVIDER_JWKS_URI not set>";
      throw new NotFoundException(
        `JWKS is not served by provider '${providerName}'. Fetch from the provider JWKS URL: ${providerJwksUrl}`,
      );
    }
    return jwks;
  }

  private resolveTokenEnvironment(
    requestedEnvironment?: ApicenterRuntimeEnvironment,
  ): { environment: ApicenterRuntimeEnvironment } {
    if (requestedEnvironment) {
      return { environment: requestedEnvironment };
    }

    throw new ValidationError("environment is required");
  }
  private validateTokenService(
    serviceId: string,
    environment: ApicenterRuntimeEnvironment,
  ): ServiceRegistryEntry {
    const service = this.registry.get(serviceId);
    if (!service) {
      throw new NotFoundError(`Unknown service: ${serviceId}`);
    }

    if ((service.serviceType ?? "tribe") !== "tribe") {
      throw new ForbiddenError(
        `Service '${serviceId}' is a shared platform service and cannot request tribe tokens`,
      );
    }

    const serviceEnvironment = service.environments?.find(
      (row) => row.environment === environment,
    );
    if (!serviceEnvironment || serviceEnvironment.status !== "active") {
      throw new ForbiddenError(
        `Service '${serviceId}' is not active in '${environment}'`,
      );
    }

    return service;
  }

  /** The service's project and tribe must both be active; a suspended tribe cannot mint tokens. */
  private resolvePlacement(service: ServiceRegistryEntry) {
    let placement;
    try {
      placement = this.tenancy.requireActiveProject(service.projectId);
    } catch (err) {
      throw new ForbiddenError(
        `Service '${service.serviceId}' cannot receive tokens: ${(err as Error).message}`,
      );
    }
    if (placement.tribe.tribeId !== service.ownerTribeId) {
      throw new ForbiddenError(
        `Service '${service.serviceId}' tribe '${service.ownerTribeId ?? ""}' does not match project '${placement.project.projectId}'`,
      );
    }
    return placement;
  }

  private buildGrant(
    serviceId: string,
    placement: ReturnType<AuthController["resolvePlacement"]>,
  ): ServiceTokenGrant {
    return {
      identity: {
        serviceId,
        projectId: placement.project.projectId,
        tribeId: placement.tribe.tribeId,
      },
      permissions: [
        `service:${serviceId}:read`,
        `service:${serviceId}:write`,
        "external:read",
      ],
      scopes: this.scopesFor(serviceId),
    };
  }

  /** Scopes of every service this caller may reach: its project siblings plus its explicit consumes. */
  private scopesFor(serviceId: string): string[] {
    const scopes = new Set<string>();
    for (const targetId of this.registry.getCallableServiceIds(serviceId)) {
      const target = this.registry.get(targetId);
      const targetScopes = target
        ? target.requiredScopes
        : getPlatformCapabilityScopes(targetId);
      for (const scope of targetScopes) scopes.add(scope);
    }
    return [...scopes];
  }
}
