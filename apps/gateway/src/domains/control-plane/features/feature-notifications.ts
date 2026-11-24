import { Injectable, Logger } from "@nestjs/common";
import { AuditEventsService } from "@audit/audit-events.service";
import { PrismaService } from "@database/prisma.service";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { consoleUrlFrom } from "../member-invite";
import { PlatformMailService } from "../platform-mail.service";
import { PlatformOperatorsService } from "../platform-operators.service";
import { withTenant } from "../tenant-transaction";
import { FEATURE_CATALOG, type FeatureKey } from "./feature-catalog";
import type { FeatureRequest } from "./feature-request.service";

@Injectable()
export class FeatureNotifications {
  private readonly logger = new Logger(FeatureNotifications.name);

  constructor(private readonly mail: PlatformMailService, private readonly operators: PlatformOperatorsService,
    private readonly prisma: PrismaService, private readonly audit: AuditEventsService) {}

  requested(request: FeatureRequest) {
    return this.attempt(async () => {
      const title = FEATURE_CATALOG[request.feature].title;
      const name = await this.projectName(request);
      return this.mail.send({
        to: await this.otherOperators(request.requestedBy),
        subject: `APICenter: ${title} requested for ${name} (${request.environmentKind})`,
        text: `${request.requestedBy} requested ${title} for ${name} in ${request.environmentKind}.\n\n${request.reason}\n\n${this.approvalsUrl()}`,
      });
    }, request.id);
  }

  decided(request: FeatureRequest) {
    return this.attempt(async () => {
      const title = FEATURE_CATALOG[request.feature].title;
      return this.mail.send({
        to: [request.requestedBy], subject: `APICenter: ${title} ${request.status}`,
        text: `Your request for ${title} in ${request.environmentKind} was ${request.status}.`
          + (request.decisionNote ? `\n\n${request.decisionNote}` : "") + `\n\n${this.approvalsUrl()}`,
      });
    }, request.id);
  }

  async override(scope: EnvironmentScope, feature: FeatureKey, change: Record<string, unknown>, actor: string) {
    const notification = await this.attempt(async () => {
      const definition = FEATURE_CATALOG[feature];
      const name = await this.projectName(scope);
      return this.mail.send({
        to: await this.otherOperators(actor), subject: `APICenter: ${definition.title} changed for ${name}`,
        text: `${actor} changed ${name} in ${scope.environmentKind}.\n\n${definition.summary(change)}\n\n${this.approvalsUrl()}`,
      });
    }, scope.projectId);
    await this.audit.record({
      type: "feature.operator_override", actionFamily: "lifecycle", severity: "info", actor,
      organizationId: scope.organizationId, projectId: scope.projectId, environment: scope.environmentKind,
      resourceType: "project_feature", resourceId: feature, message: "Operator enabled a gated feature directly",
      payload: { feature, change, notification },
    });
  }

  private async attempt(send: () => Promise<"sent" | "not_sent">, resourceId: string) {
    try {
      if (await send() === "sent") return "sent";
    } catch {
      // The feature action can succeed independently of notification delivery.
    }
    this.logger.warn(`Feature notification was not sent for ${resourceId}`);
    return "not_sent";
  }

  private async otherOperators(actor: string) {
    return (await this.operators.list()).map((operator) => operator.email).filter((email) => email !== actor.toLowerCase());
  }

  private async projectName(scope: Pick<EnvironmentScope, "organizationId" | "projectId">) {
    return withTenant(this.prisma, scope, async (db) => {
      const project = await db.cpProject.findFirst({ where: { organizationId: scope.organizationId, id: scope.projectId }, select: { name: true } });
      return (project?.name ?? scope.projectId).replace(/[\r\n]/g, " ");
    });
  }

  private approvalsUrl() {
    return `${consoleUrlFrom(process.env.MANAGEMENT_CONSOLE_URL)}/approvals`;
  }
}
