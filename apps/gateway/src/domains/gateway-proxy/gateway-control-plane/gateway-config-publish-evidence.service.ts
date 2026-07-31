import { Injectable, Optional } from "@nestjs/common";
import { AuditEventsService } from "@analytics/audit-events.service";

export type GatewayConfigPublishEvidenceInput = {
  configVersion: string;
  checksum: string;
  targetEnvironment: string;
  approvedBy: string;
  approvalRequestId?: string;
  routeCount: number;
  publishedAt?: Date;
};

export type GatewayConfigPublishEvidence = {
  configVersion: string;
  checksum: string;
  targetEnvironment: string;
  approvedBy: string;
  approvalRequestId?: string;
  routeCount: number;
  publishedAt: string;
};

@Injectable()
export class GatewayConfigPublishEvidenceService {
  constructor(@Optional() private readonly auditEvents?: AuditEventsService) {}

  recordPublishedSnapshot(
    input: GatewayConfigPublishEvidenceInput,
  ): GatewayConfigPublishEvidence {
    const evidence: GatewayConfigPublishEvidence = {
      configVersion: input.configVersion,
      checksum: input.checksum,
      targetEnvironment: input.targetEnvironment,
      approvedBy: input.approvedBy,
      approvalRequestId: input.approvalRequestId,
      routeCount: input.routeCount,
      publishedAt: (input.publishedAt ?? new Date()).toISOString(),
    };

    this.auditEvents
      ?.record({
        type: "gateway.config.published",
        actionFamily: "gateway",
        actor: input.approvedBy,
        severity: "info",
        message: `Gateway config ${input.configVersion} published for ${input.targetEnvironment}`,
        payload: evidence,
      })
      .catch(() => undefined);

    return evidence;
  }
}
