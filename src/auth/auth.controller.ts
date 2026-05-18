// =============================================================================
// src/auth/auth.controller.ts — Token issuance, refresh, revocation + JWKS
// =============================================================================
// ENDPOINTS:
//   POST /api/v1/auth/token                    — issue a scoped M2M token
//   POST /api/v1/auth/token/refresh            — refresh an expiring token
//   POST /api/v1/auth/token/revoke             — revoke a refresh token (Redis + Kafka)
//   GET  /api/v1/auth/.well-known/jwks.json    — JWKS document for local issuers
// =============================================================================

import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  UseGuards,
  NotFoundException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RegistryService } from "../registry/registry.service";
import { LoggerService } from "../shared/logger.service";
import { KafkaService } from "../kafka/kafka.service";
import { TOPICS } from "../kafka/topics";
import { NotFoundError, UnauthorizedError } from "../shared/errors";
import { TokenRequestDto } from "../shared/dto/token-request.dto";
import { RefreshTokenDto } from "../shared/dto/refresh-token.dto";
import { RevokeTokenDto } from "../shared/dto/revoke-token.dto";
import { AuthenticatedRequest } from "../types";
import { ConfigService } from "../config/config.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registry: RegistryService,
    private readonly logger: LoggerService,
    private readonly kafka: KafkaService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/token — Issue M2M JWT
  // ---------------------------------------------------------------------------

  @Post("token")
  async issueToken(
    @Body() dto: TokenRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { tribeId, secret } = dto;

    const service = this.registry.get(tribeId);
    if (!service) {
      throw new NotFoundError(`Unknown service: ${tribeId}`);
    }

    const isValid = await this.registry.validateSecret(tribeId, secret);
    if (!isValid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Scopes granted per external API name when listed in a tribe's consumes array.
    // External APIs are not in the registry, so we use a static map here.
    const EXTERNAL_API_SCOPE_MAP: Record<string, string[]> = {
      kafka: ["external:kafka:read", "external:kafka:write"],
    };

    // Build scopes: own + owned microservices + consumable targets + external APIs.
    const ownScopes = service.requiredScopes || [];
    const ownedServiceScopes = this.registry
      .getOwnedServices(tribeId)
      .flatMap((ownedService) => ownedService.requiredScopes ?? []);
    const effectiveConsumes =
      this.registry.getEffectiveConsumesForTribe(tribeId);
    const consumableScopes: string[] = [];
    const externalApiScopes: string[] = [];
    for (const targetId of effectiveConsumes) {
      const target = this.registry.get(targetId);
      if (target) {
        consumableScopes.push(...target.requiredScopes);
      } else if (EXTERNAL_API_SCOPE_MAP[targetId]) {
        externalApiScopes.push(...EXTERNAL_API_SCOPE_MAP[targetId]);
      }
    }
    const scopes = [
      ...new Set([
        ...ownScopes,
        ...ownedServiceScopes,
        ...consumableScopes,
        ...externalApiScopes,
      ]),
    ];
    const permissions = [
      `tribe:${tribeId}:read`,
      `tribe:${tribeId}:write`,
      "external:read",
    ];

    const token = await this.auth.issueToken(tribeId, permissions, scopes);

    this.logger.info("Token issued", {
      serviceId: tribeId,
      scopes,
      correlationId: req.correlationId,
    });

    this.kafka.publishNonBlocking(
      TOPICS.TOKEN_ISSUED,
      {
        tribeId,
        sub: tribeId,
        scopes,
        permissions,
        expiresIn: token.expiresIn,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
      {
        key: tribeId,
        context: "AuthController",
      },
    );

    return {
      success: true,
      data: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? null,
        expiresIn: token.expiresIn,
        tribeId,
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
  // POST /api/v1/auth/token/refresh — Refresh access token
  // ---------------------------------------------------------------------------

  @Post("token/refresh")
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const resp = await this.auth.refreshToken(dto.refreshToken);

    this.logger.info("Token refreshed", { correlationId: req.correlationId });

    this.kafka.publishNonBlocking(
      TOPICS.TOKEN_REFRESHED,
      {
        sub: "unknown", // sub extracted inside AuthService; event still useful for audit
        expiresIn: resp.expiresIn,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
      {
        context: "AuthController",
      },
    );

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
  // POST /api/v1/auth/token/revoke — Revoke refresh token
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

    this.kafka.publishNonBlocking(
      TOPICS.TOKEN_REVOKED,
      {
        sub,
        revokedCount,
        reason: dto.revokeAll ? "session-wide" : "explicit",
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
      {
        context: "AuthController",
      },
    );

    res.status(HttpStatus.NO_CONTENT).send();
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/.well-known/jwks.json — JWKS for API Center-signed tokens
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
}
