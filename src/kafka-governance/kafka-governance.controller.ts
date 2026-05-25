import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthService } from "../auth/auth.service";
import { PolicyEngineService } from "../policy/policy-engine.service";
import { PolicyRuleExplanation } from "../policy/policy-rule.types";
import { TribeQuotaEnforcerService } from "../quotas/tribe-quota-enforcer.service";
import { ForbiddenError } from "../shared/errors";
import { AuthenticatedRequest } from "../types";
import { KafkaPublishMessageDto } from "./dto/kafka-publish-message.dto";
import { KafkaGovernanceService } from "./kafka-governance.service";

@Controller("kafka")
@UseGuards(JwtAuthGuard)
export class KafkaGovernanceController {
  constructor(
    private readonly kafkaGovernance: KafkaGovernanceService,
    private readonly auth: AuthService,
    private readonly quotaEnforcer?: TribeQuotaEnforcerService,
    private readonly policyEngine?: PolicyEngineService,
  ) {}

  @Get("governance")
  getGovernanceCatalog(@Req() req: AuthenticatedRequest) {
    const tribeId = this.resolveTribeId(req);
    this.ensureScopes(req, ["external:kafka:read"]);

    return {
      success: true,
      data: this.kafkaGovernance.getGovernanceCatalog(tribeId),
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
      },
    };
  }

  @Get("schemas")
  getSchemaCatalog(@Req() req: AuthenticatedRequest) {
    const tribeId = this.resolveTribeId(req);
    this.ensureScopes(req, ["external:kafka:read"]);

    return {
      success: true,
      data: this.kafkaGovernance.getSchemaCatalog(),
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
      },
    };
  }

  @Post("publish")
  async publishMessage(
    @Body() dto: KafkaPublishMessageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const tribeId = this.resolveTribeId(req);
    this.ensureScopes(req, ["external:kafka:write"]);
    const policy = this.evaluatePolicy(req, dto.topic);

    await this.quotaEnforcer?.check({
      ownerTribeId: tribeId,
      scope: "kafka_publish",
      targetServiceId: "kafka",
      routeFamily: "kafka:publish",
      correlationId: req.correlationId,
    });

    const result = await this.kafkaGovernance.publishMessage(
      tribeId,
      dto,
      req.correlationId,
    );

    return {
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        tribeId,
        correlationId: req.correlationId,
        policy,
      },
    };
  }

  private resolveTribeId(req: AuthenticatedRequest): string {
    const tribeId = req.user?.tribeId ?? req.tribeId;
    if (!tribeId) {
      throw new ForbiddenError(
        "Kafka governance requires a token with tribeId claim",
      );
    }

    return tribeId;
  }

  private ensureScopes(
    req: AuthenticatedRequest,
    requiredScopes: string[],
  ): void {
    const missingScopes = this.auth.checkScopes(req, requiredScopes);
    if (missingScopes.length > 0) {
      throw new ForbiddenError(
        `Missing required scopes: ${missingScopes.join(", ")}`,
      );
    }
  }

  private evaluatePolicy(
    req: AuthenticatedRequest,
    topic: string,
  ): PolicyRuleExplanation[] {
    const explanations =
      this.policyEngine?.evaluate({
        targetEnvironment: this.resolveTargetEnvironment(req, topic),
        serviceType: "tribe",
        hasActivePlan: true,
        hasActiveQuota: Boolean(this.quotaEnforcer),
      }) ?? [];
    const blocks = explanations.filter(
      (explanation) => explanation.decision === "block",
    );

    if (blocks.length) {
      throw new ForbiddenError(JSON.stringify(blocks[0]));
    }

    return explanations;
  }

  private resolveTargetEnvironment(req: AuthenticatedRequest, topic: string) {
    if (req.headers?.["x-apicenter-target-environment"] === "live") {
      return "live";
    }

    return topic.startsWith("prod.") ? "live" : "test";
  }
}
