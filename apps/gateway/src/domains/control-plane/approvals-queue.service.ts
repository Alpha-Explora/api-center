// Loads pending live activation requests and API access requests, across all organizations or for
// one. Deciding stays on the existing routes (live-environment.service, published-api.service).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { ApprovalRequestService } from "@approvals/approval-request.service";
import { buildApprovalItems, type ApprovalItem } from "./approvals-queue";
import { withTenant, type TenantScope } from "./tenant-transaction";

/** How far back the "recently decided" view reaches. */
export const DECIDED_WINDOW_DAYS = 30;

@Injectable()
export class ApprovalsQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalRequestService,
  ) {}

  /** Waiting items, or (`decided`) those decided in the last DECIDED_WINDOW_DAYS days. */
  async list(scope: TenantScope, state: "pending" | "decided" = "pending", now = new Date()): Promise<ApprovalItem[]> {
    const inOrganization = scope === "platform" ? {} : { organizationId: scope.organizationId };
    const since = new Date(now.getTime() - DECIDED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const loaded = await withTenant(this.prisma, scope, async (db) => {
      const projects = await db.cpProject.findMany({ where: inOrganization, select: { id: true, organizationId: true, name: true } });
      const accessRequests = await db.cpApiAccessRequest.findMany({
        where:
          state === "pending"
            ? { ...inOrganization, status: "pending" }
            : { ...inOrganization, status: { in: ["approved", "rejected"] }, decidedAt: { gte: since } },
        ...(state === "decided" ? { orderBy: { decidedAt: "desc" as const }, take: 200 } : {}),
      });
      const apiIds = [...new Set(accessRequests.map((row) => row.apiId))];
      const applicationIds = [...new Set(accessRequests.map((row) => row.consumerApplicationId))];
      const apis = apiIds.length
        ? await db.cpPublishedApi.findMany({
            where: { ...inOrganization, id: { in: apiIds } },
            select: { id: true, organizationId: true, projectId: true, name: true, environmentKind: true },
          })
        : [];
      const applications = applicationIds.length
        ? await db.cpApplication.findMany({ where: { ...inOrganization, id: { in: applicationIds } }, select: { id: true, name: true } })
        : [];
      const organizationIds = [...new Set(projects.map((row) => row.organizationId))];
      const organizations = organizationIds.length
        ? await db.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } })
        : [];
      return { projects, accessRequests, apis, applications, organizations };
    });
    // Activation requests live in the governance schema and carry only the project ID, so they are
    // matched to this scope's projects; requests for projects outside it are dropped.
    const targets = scope === "platform" ? undefined : loaded.projects.map((project) => project.id);
    const activations =
      state === "pending"
        ? await this.approvals.listPending("environment.activate_live", targets)
        : await this.approvals.listDecided("environment.activate_live", since, targets);
    return buildApprovalItems({ ...loaded, activations });
  }
}
